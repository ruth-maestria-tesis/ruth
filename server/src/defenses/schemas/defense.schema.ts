import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { DefenseModality, DefenseStatus } from '@thesis/shared';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

const ObjectId = MongooseSchema.Types.ObjectId;

@Schema({ _id: false, id: false })
export class DefenseConfirmation {
  @Prop({ type: ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  confirmedAt!: Date;
}
export const DefenseConfirmationSchema =
  SchemaFactory.createForClass(DefenseConfirmation);

@Schema({ timestamps: true })
export class Defense {
  @Prop({ type: ObjectId, ref: 'Thesis', required: true })
  thesisId!: Types.ObjectId;

  @Prop({ required: true })
  scheduledAt!: Date;

  @Prop({ type: String, enum: Object.values(DefenseModality), required: true })
  modality!: DefenseModality;

  @Prop({ trim: true, maxlength: 300 })
  location?: string;

  @Prop({ trim: true, maxlength: 500 })
  meetingUrl?: string;

  @Prop({
    type: String,
    enum: Object.values(DefenseStatus),
    required: true,
    default: DefenseStatus.PROPOSED,
  })
  status!: DefenseStatus;

  /** false once CANCELLED; backs the one-open-defense-per-thesis index. Always $set with status. */
  @Prop({ required: true, default: true })
  isOpen!: boolean;

  @Prop({ type: [DefenseConfirmationSchema], default: [] })
  confirmations!: DefenseConfirmation[];

  @Prop({ type: ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;
}

export type DefenseDocument = HydratedDocument<Defense>;
export const DefenseSchema = applyJsonTransform(
  SchemaFactory.createForClass(Defense),
);
DefenseSchema.index(
  { thesisId: 1 },
  { unique: true, partialFilterExpression: { isOpen: true } },
);
DefenseSchema.index({ scheduledAt: 1 });
