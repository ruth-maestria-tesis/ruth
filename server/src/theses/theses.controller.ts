import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import type { Response } from 'express';
import { AllowScoped } from '../common/decorators/allow-scoped.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { actorFrom } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { CompleteUploadDto, CreateUploadDto } from '../files/dto/upload.dto';
import { fileResponse } from '../files/file-response';
import { MAX_FILE_BYTES } from '../files/file-type';
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
    return this.theses.findMineView(user);
  }

  @AllowScoped()
  @Get(':id')
  @Roles(
    Role.ADMIN,
    Role.COORDINATOR,
    Role.STUDENT,
    Role.INTERNAL_JUROR,
    Role.EXTERNAL_JUROR,
  )
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.theses.findReadableView(id, user);
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

  @Post(':id/manuscripts')
  @Roles(Role.COORDINATOR, Role.STUDENT)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_BYTES, files: 1 },
      // Decode non-ASCII multipart filenames as UTF-8 (multer defaults to latin1).
      defParamCharset: 'utf8',
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async uploadManuscript(
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const thesis = await this.theses.addManuscript(id, file, user);
    return this.theses.viewAfterUpload(thesis, user);
  }

  /** Direct upload, step 1: `{ strategy: 'DIRECT', clientToken, pathname, expiresAt }` or MULTIPART. */
  @Post(':id/manuscripts/uploads')
  @HttpCode(200)
  @Roles(Role.COORDINATOR, Role.STUDENT)
  createManuscriptUpload(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateUploadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.theses.createManuscriptUpload(id, dto, user);
  }

  /** Direct upload, step 3: registers the uploaded blob; same response as the multipart route. */
  @Post(':id/manuscripts/uploads/complete')
  @Roles(Role.COORDINATOR, Role.STUDENT)
  async completeManuscriptUpload(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CompleteUploadDto,
    @CurrentUser() user: AuthUser,
  ) {
    const thesis = await this.theses.completeManuscriptUpload(id, dto, user);
    return this.theses.viewAfterUpload(thesis, user);
  }

  @AllowScoped()
  @Get(':id/manuscripts/:fileId')
  @Roles(
    Role.ADMIN,
    Role.COORDINATOR,
    Role.STUDENT,
    Role.INTERNAL_JUROR,
    Role.EXTERNAL_JUROR,
  )
  async downloadManuscript(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('fileId', ParseObjectIdPipe) fileId: string,
    @Query('as') as: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const opened = await this.theses.openManuscript(id, fileId, user);
    return fileResponse(opened, res, { asUrl: as === 'url' });
  }
}
