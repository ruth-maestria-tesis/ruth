import {
  Controller,
  Get,
  Header,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import type { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { ReportQueryDto } from './reports.dto';
import { ReportsService } from './reports.service';

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('reports')
@Controller('reports')
@Roles(Role.COORDINATOR, Role.ADMIN)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  summary(@Query() query: ReportQueryDto) {
    return this.reports.summary(query);
  }

  @Get('theses.xlsx')
  @Header('Cache-Control', 'no-store')
  async xlsx(
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, fileName } = await this.reports.xlsx(query);
    res.set({
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    return new StreamableFile(buffer);
  }

  @Get('theses.pdf')
  @Header('Cache-Control', 'no-store')
  async pdf(
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, fileName } = await this.reports.pdf(query);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    return new StreamableFile(buffer);
  }
}
