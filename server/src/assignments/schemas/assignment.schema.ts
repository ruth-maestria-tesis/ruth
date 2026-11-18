import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { AssignmentStatus, AssignmentType } from '@thesis/shared';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

const ObjectId = MongooseSchema.Types.ObjectId;

@Schema({ timestamps: true })
export class Assignment {
  @Prop({ type: ObjectId, ref: 'Thesis', required: true })
  thesisId!: Types.ObjectId;

  @Prop({ type: ObjectId, ref: 'User', required: true })
  jurorId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(AssignmentType),
    required: true,
    default: AssignmentType.PRIMARY,
  })
  type!: AssignmentType;

  /** 1 and 2 = primary jurors, 3 = tiebreaker (stage 5). */
  @Prop({ required: true, min: 1, max: 3 })
  slot!: number;

  @Prop({
    type: String,
    enum: Object.values(AssignmentStatus),
    required: true,
    default: AssignmentStatus.PENDING,
  })
  status!: AssignmentStatus;

  /** true while PENDING or ACCEPTED; backs the partial unique indexes below. */
  @Prop({ required: true, default: true })
  isActive!: boolean;

  @Prop({ required: true })
  assignedAt!: Date;

  @Prop({ type: ObjectId, ref: 'User', required: true })
  assignedBy!: Types.ObjectId;

  @Prop({ required: true })
  responseDeadline!: Date;

  @Prop()
  respondedAt?: Date;

  @Prop({ maxlength: 500 })
  declineReason?: string;

  /** Set when the juror accepts (evaluationBusinessDays). */
  @Prop()
  evaluationDeadline?: Date;

  /** The assignment that took this slot after a decline, expiry or replacement. */
  @Prop({ type: ObjectId, ref: 'Assignment' })
  replacedById?: Types.ObjectId;

  /** SHA-256 of the RF-J14 token; the token itself is never stored. */
  @Prop({ select: false })
  externalTokenHash?: string;

  @Prop()
  externalTokenExpiresAt?: Date;

  @Prop()
  seedTag?: string;
}

export type AssignmentDocument = HydratedDocument<Assignment>;
export const AssignmentSchema = applyJsonTransform(
  SchemaFactory.createForClass(Assignment),
  ['externalTokenHash'],
);
AssignmentSchema.index(
  { thesisId: 1, slot: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);
AssignmentSchema.index(
  { thesisId: 1, jurorId: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);
AssignmentSchema.index({ jurorId: 1, status: 1 });
AssignmentSchema.index({ status: 1, responseDeadline: 1 });
AssignmentSchema.index(
  { externalTokenHash: 1 },
  {
    unique: true,
    partialFilterExpression: { externalTokenHash: { $exists: true } },
  },
);
AssignmentSchema.index({ seedTag: 1 });
