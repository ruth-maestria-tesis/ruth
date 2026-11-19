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
import { FeedbackAction, Role } from '@thesis/shared';
import { AllowScoped } from '../common/decorators/allow-scoped.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { AuthUser } from '../common/types/auth-user';
import {
  CreateFeedbackDto,
  FeedbackReplyDto,
  QueryFeedbackDto,
  ResolveFeedbackDto,
} from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

const READERS = [
  Role.COORDINATOR,
  Role.ADMIN,
  Role.INTERNAL_JUROR,
  Role.EXTERNAL_JUROR,
  Role.STUDENT,
];
const JURORS = [Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR];

@ApiTags('feedback')
@Controller()
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @AllowScoped()
  @Get('theses/:id/feedback')
  @Roles(...READERS)
  list(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: QueryFeedbackDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.list(id, query, user);
  }

  @AllowScoped()
  @Get('theses/:id/feedback/summary')
  @Roles(...READERS)
  summary(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.summary(id, user);
  }

  /** Manual REVISIONS_IN_PROGRESS → READY_FOR_DEFENSE when no feedback is unresolved. */
  @Post('theses/:id/ready-for-defense')
  @HttpCode(200)
  @Roles(Role.COORDINATOR)
  readyForDefense(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.markReadyForDefense(id, user);
  }

  /** CU-06: a juror with an ACCEPTED assignment adds an item (PENDING). */
  @AllowScoped()
  @Post('theses/:id/feedback')
  @Roles(...JURORS)
  create(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateFeedbackDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.create(id, dto, user);
  }

  @Post('feedback/:id/address')
  @HttpCode(200)
  @Roles(Role.STUDENT)
  address(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: FeedbackReplyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.transition(
      id,
      FeedbackAction.ADDRESS,
      dto.content,
      user,
    );
  }

  @AllowScoped()
  @Post('feedback/:id/resolve')
  @HttpCode(200)
  @Roles(...JURORS)
  resolve(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ResolveFeedbackDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.transition(
      id,
      FeedbackAction.RESOLVE,
      dto.content,
      user,
    );
  }

  @AllowScoped()
  @Post('feedback/:id/reopen')
  @HttpCode(200)
  @Roles(...JURORS)
  reopen(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: FeedbackReplyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.transition(
      id,
      FeedbackAction.REOPEN,
      dto.content,
      user,
    );
  }

  @AllowScoped()
  @Post('feedback/:id/comment')
  @HttpCode(200)
  @Roles(...READERS)
  comment(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: FeedbackReplyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.comment(id, dto.content, user);
  }
}
