import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { paginate } from '../common/pagination/paginate';
import { Paginated } from '../common/pagination/pagination.dto';
import { QueryAuditDto } from './dto/query-audit.dto';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

export interface AuditEntry {
  actorId?: string;
  actorRoles?: string[];
  action: string;
  method?: string;
  path?: string;
  entityType?: string;
  entityId?: string;
  statusCode?: number;
  ip?: string;
  userAgent?: string;
  meta?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name) private readonly model: Model<AuditLog>,
  ) {}

  /**
   * Fire-and-forget: never throws and never delays the caller. A failed write is logged.
   * Use it for explicit events; mutating requests are recorded by AuditInterceptor.
   */
  record(entry: AuditEntry): void {
    const { actorId, ...rest } = entry;
    this.model
      .create({
        ...rest,
        actorId:
          actorId && Types.ObjectId.isValid(actorId)
            ? new Types.ObjectId(actorId)
            : undefined,
        actorRoles: entry.actorRoles ?? [],
        at: new Date(),
      })
      .catch((err: unknown) =>
        this.logger.error(
          `Failed to record audit entry "${entry.action}"`,
          err instanceof Error ? err.stack : String(err),
        ),
      );
  }

  /** Newest first. */
  list(query: QueryAuditDto): Promise<Paginated<AuditLogDocument>> {
    const filter: FilterQuery<AuditLog> = {};
    if (query.actorId) filter.actorId = query.actorId;
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId) filter.entityId = query.entityId;
    if (query.action) filter.action = query.action;
    if (query.from || query.to) {
      filter.at = {
        ...(query.from && { $gte: new Date(query.from) }),
        ...(query.to && { $lte: new Date(query.to) }),
      };
    }
    return paginate(
      this.model,
      filter,
      { ...query, sort: 'at', order: 'desc' },
      { sortFields: { at: 'at' }, defaultSort: 'at' },
    );
  }
}
