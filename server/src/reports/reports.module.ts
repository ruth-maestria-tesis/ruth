import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Assignment,
  AssignmentSchema,
} from '../assignments/schemas/assignment.schema';
import { Period, PeriodSchema } from '../catalogs/schemas/period.schema';
import { Program, ProgramSchema } from '../catalogs/schemas/program.schema';
import { Thesis, ThesisSchema } from '../theses/schemas/thesis.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    // Read-only models; the owning modules keep the writes.
    MongooseModule.forFeature([
      { name: Thesis.name, schema: ThesisSchema },
      { name: Assignment.name, schema: AssignmentSchema },
      { name: User.name, schema: UserSchema },
      { name: Program.name, schema: ProgramSchema },
      { name: Period.name, schema: PeriodSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
