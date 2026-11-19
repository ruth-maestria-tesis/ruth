import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Put,
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
import { actorFrom } from '../common/types/actor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { AuthUser } from '../common/types/auth-user';
import { CompleteUploadDto, CreateUploadDto } from '../files/dto/upload.dto';
import { fileResponse } from '../files/file-response';
import { MAX_FILE_BYTES } from '../files/file-type';
import { SaveEvaluationDto } from './dto/evaluation.dto';
import { EvaluationsService } from './evaluations.service';

const READERS = [
  Role.COORDINATOR,
  Role.ADMIN,
  Role.INTERNAL_JUROR,
  Role.EXTERNAL_JUROR,
  Role.STUDENT,
];
const JURORS = [Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR];

@ApiTags('evaluations')
@Controller()
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @AllowScoped()
  @Get('theses/:id/evaluations')
  @Roles(...READERS)
  listForThesis(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.evaluations.listForThesis(id, user);
  }

  /** CU-05: comparison of the primary evaluations and the tiebreaker. */
  @Get('theses/:id/dispute')
  @Roles(Role.COORDINATOR, Role.ADMIN)
  dispute(@Param('id', ParseObjectIdPipe) id: string) {
    return this.evaluations.dispute(id);
  }

  /** RN-08 retry when the transition after the last submit failed; idempotent. */
  @Post('theses/:id/evaluation-outcome/reconcile')
  @HttpCode(200)
  @Roles(Role.COORDINATOR, Role.ADMIN)
  reconcile(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.evaluations.reconcileOutcome(
      id,
      actorFrom(user, Role.COORDINATOR, Role.ADMIN),
    );
  }

  /** The owner's evaluation, or a JSON `null` (never 204). */
  @AllowScoped()
  @Get('assignments/:id/evaluation')
  @Roles(...JURORS)
  async mine(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    res.status(200).json(await this.evaluations.findForAssignment(id, user));
  }

  /** CU-02 draft upsert. */
  @AllowScoped()
  @Put('assignments/:id/evaluation')
  @Roles(...JURORS)
  save(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SaveEvaluationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.evaluations.saveDraft(id, dto, user);
  }

  /** CU-02 submit (no edits afterwards), then RN-08. The body may carry last changes. */
  @AllowScoped()
  @Post('assignments/:id/evaluation/submit')
  @HttpCode(200)
  @Roles(...JURORS)
  submit(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SaveEvaluationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.evaluations.submit(id, dto, user);
  }

  @AllowScoped()
  @Post('evaluations/:id/corrections')
  @Roles(...JURORS)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_BYTES, files: 1 },
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
  uploadCorrection(
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.evaluations.addCorrection(id, file, user);
  }

  /** Direct upload, step 1: `{ strategy: 'DIRECT', clientToken, pathname, expiresAt }` or MULTIPART. */
  @AllowScoped()
  @Post('evaluations/:id/corrections/uploads')
  @HttpCode(200)
  @Roles(...JURORS)
  createCorrectionUpload(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateUploadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.evaluations.createCorrectionUpload(id, dto, user);
  }

  /** Direct upload, step 3: registers the uploaded blob; same response as the multipart route. */
  @AllowScoped()
  @Post('evaluations/:id/corrections/uploads/complete')
  @Roles(...JURORS)
  completeCorrectionUpload(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CompleteUploadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.evaluations.completeCorrectionUpload(id, dto, user);
  }

  @AllowScoped()
  @Get('evaluations/:id')
  @Roles(...READERS)
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
  ) {
    return this.evaluations.findOne(id, user, ip);
  }

  @AllowScoped()
  @Get('evaluations/:id/files/:fileId')
  @Roles(...READERS)
  async download(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('fileId', ParseObjectIdPipe) fileId: string,
    @Query('as') as: string | undefined,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const opened = await this.evaluations.openCorrection(id, fileId, user, ip);
    return fileResponse(opened, res, { asUrl: as === 'url' });
  }
}
