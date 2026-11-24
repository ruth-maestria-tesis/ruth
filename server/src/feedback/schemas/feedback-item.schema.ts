import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  FeedbackAction,
  FeedbackChapter,
  FeedbackStatus,
} from '@thesis/shared';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

const ObjectId = MongooseSchema.Types.ObjectId;

@Schema({ _id: false, id: false })
export class FeedbackReply {
  @Prop({ type: ObjectId, required: true })
  authorId!: Types.ObjectId;

  @Prop({ required: true })
  authorName!: string;

  @Prop({ required: true })
  authorRole!: string;

  @Prop({ default: '', maxlength: 5000 })
  content!: string;

  @Prop({ type: [ObjectId], default: [] })
  fileIds!: Types.ObjectId[];

  @Prop({ type: String, enum: Object.values(FeedbackAction), required: true })
  action!: FeedbackAction;

  @Prop({ required: true })
  at!: Date;
}
export const FeedbackReplySchema = SchemaFactory.createForClass(FeedbackReply);

@Schema({ timestamps: true, collection: 'feedbackItems' })
export class FeedbackItem {
  @Prop({ type: ObjectId, ref: 'Thesis', required: true })
  thesisId!: Types.ObjectId;

  @Prop({ type: ObjectId, ref: 'User', required: true })
  jurorId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(FeedbackChapter),
    required: true,
    default: FeedbackChapter.GENERAL,
  })
  chapter!: FeedbackChapter;

  @Prop({ maxlength: 200 })
  reference?: string;

  @Prop({ required: true, maxlength: 20000 })
  content!: string;

  @Prop({
    type: String,
    enum: Object.values(FeedbackStatus),
    required: true,
    default: FeedbackStatus.PENDING,
  })
  status!: FeedbackStatus;

  @Prop({ type: [FeedbackReplySchema], default: [] })
  replies!: FeedbackReply[];

  @Prop()
  seedTag?: string;
}

export type FeedbackItemDocument = HydratedDocument<FeedbackItem>;
export const FeedbackItemSchema = applyJsonTransform(
  SchemaFactory.createForClass(FeedbackItem),
);
FeedbackItemSchema.index({ thesisId: 1, status: 1 });
