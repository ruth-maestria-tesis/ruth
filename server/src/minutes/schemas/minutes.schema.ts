import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { MinutesStatus, MinutesVerdict, Role } from '@thesis/shared';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

const ObjectId = MongooseSchema.Types.ObjectId;

@Schema({ _id: false, id: false })
export class RequiredSigner {
  @Prop({ type: ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  /** INTERNAL_JUROR, EXTERNAL_JUROR or COORDINATOR. */
  @Prop({ type: String, enum: Object.values(Role), required: true })
  role!: Role;
}
export const RequiredSignerSchema =
  SchemaFactory.createForClass(RequiredSigner);

@Schema({ _id: false, id: false })
export class MinutesSignature {
  @Prop({ type: ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(Role), required: true })
  role!: Role;

  @Prop({ required: true })
  signedAt!: Date;

  /** The hash the signer saw (RNF-04). */
  @Prop({ required: true })
  contentHash!: string;

  @Prop()
  ip?: string;

  @Prop({ maxlength: 500 })
  userAgent?: string;
}
export const MinutesSignatureSchema =
  SchemaFactory.createForClass(MinutesSignature);

@Schema({ timestamps: true, collection: 'minutes' })
export class Minutes {
  @Prop({ type: ObjectId, ref: 'Thesis', required: true })
  thesisId!: Types.ObjectId;

  @Prop({ type: ObjectId, ref: 'Defense', required: true })
  defenseId!: Types.ObjectId;

  /** e.g. MIETIA-2026-001: sequence per program code and year. */
  @Prop({ required: true, unique: true })
  number!: string;

  @Prop({ required: true, min: 0, max: 5 })
  finalGrade!: number;

  @Prop({ type: String, enum: Object.values(MinutesVerdict), required: true })
  verdict!: MinutesVerdict;

  @Prop({ default: '', maxlength: 5000 })
  remarks!: string;

  @Prop({ required: true })
  contentHash!: string;

  @Prop({
    type: String,
    enum: Object.values(MinutesStatus),
    required: true,
    default: MinutesStatus.DRAFT,
  })
  status!: MinutesStatus;

  @Prop({ type: [RequiredSignerSchema], default: [] })
  requiredSigners!: RequiredSigner[];

  @Prop({ type: [MinutesSignatureSchema], default: [] })
  signatures!: MinutesSignature[];

  @Prop({ type: ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop()
  sealedAt?: Date;

  @Prop({ type: ObjectId })
  pdfFileId?: Types.ObjectId;
}

export type MinutesDocument = HydratedDocument<Minutes>;
export const MinutesSchema = applyJsonTransform(
  SchemaFactory.createForClass(Minutes),
);
MinutesSchema.index({ thesisId: 1 }, { unique: true });
