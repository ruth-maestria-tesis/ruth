import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode, Role } from '@thesis/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { Assignment } from '../assignments/schemas/assignment.schema';
import { AppException } from '../common/errors/app.exception';
import { paginate } from '../common/pagination/paginate';
import type { Paginated } from '../common/pagination/pagination.dto';
import type { AuthUser } from '../common/types/auth-user';
import { User } from '../users/schemas/user.schema';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';

export interface NotificationPayload {
  type: string;
  title: string;
  body: string;
  link?: string;
  entityRef?: { kind: string; id: string };
  /** The thesis the notification is about; lets scoped sessions see only theirs. */
  thesisId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly model: Model<Notification>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Assignment.name)
    private readonly assignments: Model<Assignment>,
  ) {}

  /** One notification per distinct, valid recipient. Returns how many were created. */
  async notify(
    userIds: ReadonlyArray<string | undefined | null>,
    payload: NotificationPayload,
  ): Promise<number> {
    const ids = [
      ...new Set(
        userIds.filter(
          (id): id is string => !!id && Types.ObjectId.isValid(id),
        ),
      ),
    ];
    if (!ids.length) return 0;
    const { thesisId, ...rest } = payload;
    const thesis =
      thesisId && Types.ObjectId.isValid(thesisId)
        ? { thesisId: new Types.ObjectId(thesisId) }
        : {};
    await this.model.insertMany(
      ids.map((id) => ({ ...rest, ...thesis, userId: new Types.ObjectId(id) })),
    );
    return ids.length;
  }

  async notifyRole(role: Role, payload: NotificationPayload): Promise<number> {
    const users = await this.users
      .find({ roles: role, isActive: true }, { _id: 1 })
      .lean()
      .exec();
    return this.notify(
      users.map((u) => String(u._id)),
      payload,
    );
  }

  /**
   * The user's own notifications. A scoped (external-link) session only sees those about
   * its assigned thesis: by `thesisId`, or by an `entityRef` to the thesis or assignment.
   */
  private async ownFilter(user: AuthUser): Promise<FilterQuery<Notification>> {
    const own: FilterQuery<Notification> = {
      userId: new Types.ObjectId(user.id),
    };
    if (!user.scope) return own;
    const assignmentIds = user.scope.assignmentIds.filter((id) =>
      Types.ObjectId.isValid(id),
    );
    const rows = await this.assignments
      .find({ _id: { $in: assignmentIds }, jurorId: user.id }, 'thesisId')
      .lean()
      .exec();
    const thesisIds = rows.map((r) => r.thesisId);
    return {
      ...own,
      $or: [
        { thesisId: { $in: thesisIds } },
        {
          'entityRef.kind': 'thesis',
          'entityRef.id': { $in: thesisIds.map((t) => t.toHexString()) },
        },
        {
          'entityRef.kind': 'assignment',
          'entityRef.id': { $in: rows.map((r) => r._id.toHexString()) },
        },
      ],
    };
  }

  async list(
    user: AuthUser,
    query: QueryNotificationsDto,
  ): Promise<Paginated<NotificationDocument>> {
    return paginate(
      this.model,
      {
        ...(await this.ownFilter(user)),
        ...(query.unread ? { readAt: { $exists: false } } : {}),
      },
      { ...query, sort: 'createdAt' },
      { sortFields: { createdAt: 'createdAt' }, defaultSort: 'createdAt' },
    );
  }

  async unreadCount(user: AuthUser): Promise<{ count: number }> {
    const count = await this.model
      .countDocuments({
        ...(await this.ownFilter(user)),
        readAt: { $exists: false },
      })
      .exec();
    return { count };
  }

  async markRead(id: string, user: AuthUser): Promise<NotificationDocument> {
    const doc = await this.model
      .findOneAndUpdate(
        { ...(await this.ownFilter(user)), _id: id },
        [{ $set: { readAt: { $ifNull: ['$readAt', '$$NOW'] } } }],
        { new: true },
      )
      .exec();
    if (!doc) {
      throw new AppException(
        ErrorCode.NOTIFICATION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return doc;
  }

  async markAllRead(user: AuthUser): Promise<{ updated: number }> {
    const res = await this.model
      .updateMany(
        { ...(await this.ownFilter(user)), readAt: { $exists: false } },
        { $set: { readAt: new Date() } },
      )
      .exec();
    return { updated: res.modifiedCount };
  }
}
