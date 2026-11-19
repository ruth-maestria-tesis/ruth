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
import { ThesesModule } from '../theses/theses.module';
import { UsersModule } from '../users/users.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { DefensesController } from './defenses.controller';
import { DefensesService } from './defenses.service';
import { Defense, DefenseSchema } from './schemas/defense.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Defense.name, schema: DefenseSchema },
      // Read-only (active jurors); AssignmentsModule owns writes.
      { name: Assignment.name, schema: AssignmentSchema },
      // Read-only (has the tiebreaker evaluated?); EvaluationsModule owns writes.
      { name: Evaluation.name, schema: EvaluationSchema },
    ]),
    ThesesModule,
    UsersModule,
    WorkflowModule,
  ],
  controllers: [DefensesController],
  providers: [DefensesService],
  exports: [DefensesService],
})
export class DefensesModule {}
