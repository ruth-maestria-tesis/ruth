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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { actorFrom } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { CreateThesisDto } from './dto/create-thesis.dto';
import { QueryThesesDto } from './dto/query-theses.dto';
import { UpdateThesisDto } from './dto/update-thesis.dto';
import { ThesesService } from './theses.service';

@ApiTags('theses')
@Controller('theses')
export class ThesesController {
  constructor(private readonly theses: ThesesService) {}

  @Get()
  @Roles(Role.ADMIN, Role.COORDINATOR)
  list(@Query() query: QueryThesesDto) {
    return this.theses.list(query);
  }

  // Declared before ':id' so "mine" is not parsed as an id.
  @Get('mine')
  @Roles(Role.STUDENT)
  mine(@CurrentUser() user: AuthUser) {
    return this.theses.findMine(user.id);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.COORDINATOR, Role.STUDENT)
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.theses.findReadable(id, user);
  }

  @Post()
  @Roles(Role.COORDINATOR)
  create(@Body() dto: CreateThesisDto, @CurrentUser() user: AuthUser) {
    return this.theses.create(dto, actorFrom(user, Role.COORDINATOR));
  }

  @Patch(':id')
  @Roles(Role.COORDINATOR)
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateThesisDto,
  ) {
    return this.theses.update(id, dto);
  }
}
