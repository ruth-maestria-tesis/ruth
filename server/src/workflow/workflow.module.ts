import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Thesis, ThesisSchema } from '../theses/schemas/thesis.schema';
import { WorkflowService } from './workflow.service';

@Module({
  // Same model as ThesesModule on the same connection; avoids a ThesesModule ↔ WorkflowModule cycle.
  imports: [
    MongooseModule.forFeature([{ name: Thesis.name, schema: ThesisSchema }]),
  ],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
