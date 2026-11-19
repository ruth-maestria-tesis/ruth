import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Assignment,
  AssignmentSchema,
} from '../assignments/schemas/assignment.schema';
import { Cohort, CohortSchema } from '../catalogs/schemas/cohort.schema';
import { SettingsModule } from '../settings/settings.module';
import { Thesis, ThesisSchema } from '../theses/schemas/thesis.schema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Thesis.name, schema: ThesisSchema },
      { name: Assignment.name, schema: AssignmentSchema },
      { name: Cohort.name, schema: CohortSchema },
    ]),
    SettingsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
