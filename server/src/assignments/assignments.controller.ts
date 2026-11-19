import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { actorFrom } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { AssignmentsService } from './assignments.service';
import {
  CreateAssignmentsDto,
  ValidateAssignmentsDto,
} from './dto/create-assignments.dto';

@ApiTags('assignments')
@Controller()
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  /** CU-01: assign the two primary jurors. */
  @Post('theses/:id/assignments')
  @Roles(Role.COORDINATOR)
  assign(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateAssignmentsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assignments.assignJury(
      id,
      dto,
      actorFrom(user, Role.COORDINATOR),
    );
  }

  @Get('theses/:id/assignments')
  @Roles(Role.ADMIN, Role.COORDINATOR)
  listForThesis(@Param('id', ParseObjectIdPipe) id: string) {
    return this.assignments.listForThesis(id);
  }

  /** Live validation for the CU-01 form; saves nothing. */
  @Post('assignments/validate')
  @HttpCode(200)
  @Roles(Role.COORDINATOR)
  validate(@Body() dto: ValidateAssignmentsDto) {
    return this.assignments.validate(dto);
  }
}
