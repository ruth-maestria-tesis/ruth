import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { CatalogsService } from './catalogs.service';
import {
  CreateCohortDto,
  QueryCohortsDto,
  UpdateCohortDto,
} from './dto/cohort.dto';
import { CreatePeriodDto, UpdatePeriodDto } from './dto/period.dto';
import { CreateProgramDto, UpdateProgramDto } from './dto/program.dto';

const MANAGERS = [Role.ADMIN, Role.COORDINATOR] as const;

@ApiTags('catalogs')
@Controller('programs')
export class ProgramsController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get()
  list() {
    return this.catalogs.listPrograms();
  }

  @Post()
  @Roles(...MANAGERS)
  create(@Body() dto: CreateProgramDto) {
    return this.catalogs.createProgram(dto);
  }

  @Patch(':id')
  @Roles(...MANAGERS)
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateProgramDto,
  ) {
    return this.catalogs.updateProgram(id, dto);
  }
}

@ApiTags('catalogs')
@Controller('periods')
export class PeriodsController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get()
  list() {
    return this.catalogs.listPeriods();
  }

  @Post()
  @Roles(...MANAGERS)
  create(@Body() dto: CreatePeriodDto) {
    return this.catalogs.createPeriod(dto);
  }

  @Patch(':id')
  @Roles(...MANAGERS)
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdatePeriodDto,
  ) {
    return this.catalogs.updatePeriod(id, dto);
  }
}

@ApiTags('catalogs')
@Controller('cohorts')
export class CohortsController {
  constructor(private readonly catalogs: CatalogsService) {}

  @Get()
  list(@Query() query: QueryCohortsDto) {
    return this.catalogs.listCohorts(query);
  }

  @Post()
  @Roles(...MANAGERS)
  create(@Body() dto: CreateCohortDto) {
    return this.catalogs.createCohort(dto);
  }

  @Patch(':id')
  @Roles(...MANAGERS)
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCohortDto,
  ) {
    return this.catalogs.updateCohort(id, dto);
  }
}
