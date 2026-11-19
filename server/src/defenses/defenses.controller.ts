import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { AllowScoped } from '../common/decorators/allow-scoped.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { orJsonNull } from '../common/http/json-null';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { AuthUser } from '../common/types/auth-user';
import { DefensesService } from './defenses.service';
import {
  QueryDefensesDto,
  ScheduleDefenseDto,
  UpdateDefenseDto,
} from './dto/defense.dto';

const READERS = [
  Role.ADMIN,
  Role.COORDINATOR,
  Role.STUDENT,
  Role.INTERNAL_JUROR,
  Role.EXTERNAL_JUROR,
];

@ApiTags('defenses')
@Controller()
export class DefensesController {
  constructor(private readonly defenses: DefensesService) {}

  @Get('defenses')
  @Roles(Role.ADMIN, Role.COORDINATOR, Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR)
  list(@Query() query: QueryDefensesDto, @CurrentUser() user: AuthUser) {
    return this.defenses.list(query, user);
  }

  @AllowScoped()
  @Get('defenses/:id')
  @Roles(...READERS)
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.defenses.findOneView(id, user);
  }

  @AllowScoped()
  @Get('theses/:id/defense')
  @Roles(...READERS)
  @Header('Content-Type', 'application/json')
  async forThesis(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return orJsonNull(await this.defenses.findForThesis(id, user));
  }

  /** CU-03: the coordinator proposes the defense. */
  @Post('theses/:id/defense')
  @Roles(Role.COORDINATOR)
  schedule(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ScheduleDefenseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.defenses.schedule(id, dto, user);
  }

  @Patch('defenses/:id')
  @Roles(Role.COORDINATOR)
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateDefenseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.defenses.update(id, dto, user);
  }

  @AllowScoped()
  @Post('defenses/:id/confirm')
  @HttpCode(200)
  @Roles(Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR)
  confirm(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.defenses.confirm(id, user);
  }

  @Post('defenses/:id/cancel')
  @HttpCode(200)
  @Roles(Role.COORDINATOR)
  cancel(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.defenses.cancel(id, user);
  }
}
