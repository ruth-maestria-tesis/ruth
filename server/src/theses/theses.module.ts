import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Assignment,
  AssignmentSchema,
} from '../assignments/schemas/assignment.schema';
import { CatalogsModule } from '../catalogs/catalogs.module';
import { FilesModule } from '../files/files.module';
import { UsersModule } from '../users/users.module';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { Thesis, ThesisSchema } from './schemas/thesis.schema';
import { ThesesController } from './theses.controller';
import { ThesesService } from './theses.service';
import { ThesisCodeService } from './thesis-code';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Thesis.name, schema: ThesisSchema },
      { name: Counter.name, schema: CounterSchema },
      // Read-only use for juror access; AssignmentsModule owns writes. Avoids a module cycle.
      { name: Assignment.name, schema: AssignmentSchema },
    ]),
    CatalogsModule,
    UsersModule,
    FilesModule,
  ],
  controllers: [ThesesController],
  providers: [ThesesService, ThesisCodeService],
  exports: [ThesesService],
})
export class ThesesModule {}
