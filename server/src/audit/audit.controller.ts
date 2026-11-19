import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService } from './audit.service';
import { QueryAuditDto } from './dto/query-audit.dto';

/** Read-only on purpose: the audit log has no update or delete endpoints. */
@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(Role.ADMIN, Role.COORDINATOR)
  list(@Query() query: QueryAuditDto) {
    return this.audit.list(query);
  }
}
