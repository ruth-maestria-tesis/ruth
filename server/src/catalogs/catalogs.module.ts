import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CohortsController,
  PeriodsController,
  ProgramsController,
} from './catalogs.controller';
import { CatalogsService } from './catalogs.service';
import { Cohort, CohortSchema } from './schemas/cohort.schema';
import { Period, PeriodSchema } from './schemas/period.schema';
import { Program, ProgramSchema } from './schemas/program.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Program.name, schema: ProgramSchema },
      { name: Period.name, schema: PeriodSchema },
      { name: Cohort.name, schema: CohortSchema },
    ]),
  ],
  controllers: [ProgramsController, PeriodsController, CohortsController],
  providers: [CatalogsService],
  exports: [CatalogsService],
})
export class CatalogsModule {}
