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
import type { AuthUser } from '../common/types/auth-user';
import { CreateUserDto } from './dto/create-user.dto';
import { FacultyQueryDto, QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto, UpdateUserStatusDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(Role.ADMIN, Role.COORDINATOR)
  list(@Query() query: QueryUsersDto) {
    return this.users.list(query);
  }

  // Declared before ':id' so "faculty" is not parsed as an id.
  @Get('faculty')
  @Roles(Role.ADMIN, Role.COORDINATOR)
  faculty(@Query() query: FacultyQueryDto) {
    return this.users.searchFaculty(query.q);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.COORDINATOR)
  findOne(@Param('id') id: string) {
    return this.users.findById(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.update(id, dto, actor.id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN)
  setStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.setActive(id, dto.isActive, actor.id);
  }
}
