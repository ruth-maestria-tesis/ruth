import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode, Role } from '@thesis/shared';
import { Model, Types } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { paginate } from '../common/pagination/paginate';
import type { Paginated } from '../common/pagination/pagination.dto';
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
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly model: Model<Notification>,
    @InjectModel(User.name) private readonly users: Model<User>,
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
    await this.model.insertMany(
      ids.map((id) => ({ ...payload, userId: new Types.ObjectId(id) })),
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

  list(
    userId: string,
    query: QueryNotificationsDto,
  ): Promise<Paginated<NotificationDocument>> {
    return paginate(
      this.model,
      {
        userId: new Types.ObjectId(userId),
        ...(query.unread ? { readAt: { $exists: false } } : {}),
      },
      { ...query, sort: 'createdAt' },
      { sortFields: { createdAt: 'createdAt' }, defaultSort: 'createdAt' },
    );
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.model
      .countDocuments({
        userId: new Types.ObjectId(userId),
        readAt: { $exists: false },
      })
      .exec();
    return { count };
  }

  async markRead(id: string, userId: string): Promise<NotificationDocument> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: id, userId: new Types.ObjectId(userId) },
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

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.model
      .updateMany(
        { userId: new Types.ObjectId(userId), readAt: { $exists: false } },
        { $set: { readAt: new Date() } },
      )
      .exec();
    return { updated: res.modifiedCount };
  }
}
