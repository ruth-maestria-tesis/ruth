import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Assignment,
  AssignmentSchema,
} from '../assignments/schemas/assignment.schema';
import { Defense, DefenseSchema } from '../defenses/schemas/defense.schema';
import { Minutes, MinutesSchema } from '../minutes/schemas/minutes.schema';
import { ThesesModule } from '../theses/theses.module';
import { TraceabilityController } from './traceability.controller';
import { TraceabilityService } from './traceability.service';

@Module({
  imports: [
    ThesesModule,
    MongooseModule.forFeature([
      { name: Assignment.name, schema: AssignmentSchema },
      { name: Defense.name, schema: DefenseSchema },
      { name: Minutes.name, schema: MinutesSchema },
    ]),
  ],
  controllers: [TraceabilityController],
  providers: [TraceabilityService],
})
export class TraceabilityModule {}
