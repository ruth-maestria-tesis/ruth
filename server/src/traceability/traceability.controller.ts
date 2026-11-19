import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@thesis/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { AuthUser } from '../common/types/auth-user';
import { TraceabilityService } from './traceability.service';

@ApiTags('theses')
@Controller('theses')
export class TraceabilityController {
  constructor(private readonly traceability: TraceabilityService) {}

  @Get(':id/graph')
  @Roles(
    Role.ADMIN,
    Role.COORDINATOR,
    Role.STUDENT,
    Role.INTERNAL_JUROR,
    Role.EXTERNAL_JUROR,
  )
  graph(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.traceability.graph(id, user);
  }
}
