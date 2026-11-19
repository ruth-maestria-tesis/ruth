import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { DefensesModule } from '../defenses/defenses.module';
import { FilesModule } from '../files/files.module';
import { Counter, CounterSchema } from '../theses/schemas/counter.schema';
import { ThesesModule } from '../theses/theses.module';
import { UsersModule } from '../users/users.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { MinutesController } from './minutes.controller';
import { MinutesService } from './minutes.service';
import { Minutes, MinutesSchema } from './schemas/minutes.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Minutes.name, schema: MinutesSchema },
      // Shared `counters` collection (same model as ThesesModule).
      { name: Counter.name, schema: CounterSchema },
    ]),
    ThesesModule,
    DefensesModule,
    CatalogsModule,
    UsersModule,
    FilesModule,
    WorkflowModule,
  ],
  controllers: [MinutesController],
  providers: [MinutesService],
})
export class MinutesModule {}
