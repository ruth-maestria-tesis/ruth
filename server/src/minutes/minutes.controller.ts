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
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import type { Request, Response } from 'express';
import { AllowScoped } from '../common/decorators/allow-scoped.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { orJsonNull } from '../common/http/json-null';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { AuthUser } from '../common/types/auth-user';
import { fileResponse } from '../files/file-response';
import { CreateMinutesDto, UpdateMinutesDto } from './dto/minutes.dto';
import { MinutesService } from './minutes.service';

const READERS = [
  Role.ADMIN,
  Role.COORDINATOR,
  Role.STUDENT,
  Role.INTERNAL_JUROR,
  Role.EXTERNAL_JUROR,
];

@ApiTags('minutes')
@Controller()
export class MinutesController {
  constructor(private readonly minutes: MinutesService) {}

  /** CU-04: the coordinator drafts the minutes after the defense. */
  @Post('theses/:id/minutes')
  @Roles(Role.COORDINATOR)
  create(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateMinutesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.minutes.create(id, dto, user);
  }

  @AllowScoped()
  @Get('theses/:id/minutes')
  @Roles(...READERS)
  @Header('Content-Type', 'application/json')
  async forThesis(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return orJsonNull(await this.minutes.findForThesis(id, user));
  }

  @AllowScoped()
  @Get('minutes/:id')
  @Roles(...READERS)
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.minutes.findOneView(id, user);
  }

  @Patch('minutes/:id')
  @Roles(Role.COORDINATOR)
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateMinutesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.minutes.update(id, dto, user);
  }

  /** RNF-04: records ip and user agent with each signature. */
  @AllowScoped()
  @Post('minutes/:id/sign')
  @HttpCode(200)
  @Roles(Role.COORDINATOR, Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR)
  sign(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.minutes.sign(id, user, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  }

  @AllowScoped()
  @Get('minutes/:id/pdf')
  @Roles(...READERS)
  async pdf(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query('as') as: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const opened = await this.minutes.openPdf(id, user);
    return fileResponse(opened, res, {
      asUrl: as === 'url',
      type: 'application/pdf',
    });
  }
}
