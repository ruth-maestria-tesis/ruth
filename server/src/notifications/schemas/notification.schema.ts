import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

const ObjectId = MongooseSchema.Types.ObjectId;

@Schema({ _id: false, id: false })
export class EntityRef {
  @Prop({ required: true })
  kind!: string;

  @Prop({ required: true })
  id!: string;
}
const EntityRefSchema = SchemaFactory.createForClass(EntityRef);

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  /** Matches the domain event name, e.g. `assignment.created`. */
  @Prop({ required: true })
  type!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  body!: string;

  @Prop()
  link?: string;

  @Prop({ type: EntityRefSchema })
  entityRef?: EntityRef;

  @Prop()
  readAt?: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = applyJsonTransform(
  SchemaFactory.createForClass(Notification),
  ['userId'],
);
NotificationSchema.index({ userId: 1, readAt: 1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });
