import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { AllowScoped } from '../common/decorators/allow-scoped.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { actorFrom } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { AssignmentResponsesService } from './assignment-responses.service';
import { AssignmentsService } from './assignments.service';
import {
  CreateAssignmentsDto,
  ValidateAssignmentsDto,
} from './dto/create-assignments.dto';
import { ReplaceAssignmentDto } from './dto/replace-assignment.dto';
import { DeclineAssignmentDto, QueryMyAssignmentsDto } from './dto/respond.dto';
import { AssignTiebreakerDto } from './dto/tiebreaker.dto';

@ApiTags('assignments')
@Controller()
export class AssignmentsController {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly responses: AssignmentResponsesService,
  ) {}

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

  /** Replaces a pending, declined or expired primary juror. */
  @Post('theses/:id/assignments/replace')
  @Roles(Role.COORDINATOR)
  replace(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ReplaceAssignmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assignments.replace(id, dto, actorFrom(user, Role.COORDINATOR));
  }

  /** CU-05: designate the tiebreaker juror of an IN_DISPUTE thesis (slot 3). */
  @Post('theses/:id/assignments/tiebreaker')
  @Roles(Role.COORDINATOR)
  tiebreaker(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AssignTiebreakerDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assignments.assignTiebreaker(
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

  /** CU-08: the juror's assignments with countdown. Declared before `assignments/:id`. */
  @AllowScoped()
  @Get('assignments/mine')
  @Roles(Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR)
  mine(@CurrentUser() user: AuthUser, @Query() query: QueryMyAssignmentsDto) {
    return this.assignments.findMine(user, query);
  }

  @AllowScoped()
  @Get('assignments/:id')
  @Roles(Role.ADMIN, Role.COORDINATOR, Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR)
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assignments.findOneView(id, user);
  }

  /** CU-08 main flow. */
  @AllowScoped()
  @Post('assignments/:id/accept')
  @HttpCode(200)
  @Roles(Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR)
  accept(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.responses.accept(id, user);
  }

  /** CU-08 FA-01. */
  @AllowScoped()
  @Post('assignments/:id/decline')
  @HttpCode(200)
  @Roles(Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR)
  decline(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: DeclineAssignmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.responses.decline(id, user, dto.reason);
  }

  /** RF-J14: new access link for an external juror (invalidates the previous one). */
  @Post('assignments/:id/external-link')
  @HttpCode(200)
  @Roles(Role.COORDINATOR)
  externalLink(@Param('id', ParseObjectIdPipe) id: string) {
    return this.assignments.issueExternalLink(id);
  }
}
