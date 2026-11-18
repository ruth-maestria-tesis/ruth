import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ThesisStatus } from '@thesis/shared';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

const ObjectId = MongooseSchema.Types.ObjectId;

@Schema({ _id: false, id: false })
export class ManuscriptVersion {
  @Prop({ type: ObjectId, required: true })
  fileId!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  version!: number;

  @Prop({ required: true })
  fileName!: string;

  @Prop({ required: true })
  uploadedAt!: Date;

  @Prop({ type: ObjectId, required: true })
  uploadedBy!: Types.ObjectId;
}
export const ManuscriptVersionSchema =
  SchemaFactory.createForClass(ManuscriptVersion);

/** One entry per status change; feeds the traceability graph (CU-07). */
@Schema({ _id: false, id: false })
export class HistoryEntry {
  /** null for the initial SUBMITTED entry. */
  @Prop({
    type: String,
    enum: [...Object.values(ThesisStatus), null],
    default: null,
  })
  from!: ThesisStatus | null;

  @Prop({ type: String, enum: Object.values(ThesisStatus), required: true })
  to!: ThesisStatus;

  @Prop({ required: true })
  at!: Date;

  @Prop({ type: ObjectId })
  actorId?: Types.ObjectId;

  /** A Role, or SYSTEM for scheduler-driven changes. */
  @Prop({ required: true })
  actorRole!: string;

  @Prop({ maxlength: 1000 })
  reason?: string;

  @Prop({ type: [ObjectId], default: [] })
  evidenceFileIds!: Types.ObjectId[];
}
export const HistoryEntrySchema = SchemaFactory.createForClass(HistoryEntry);

@Schema({ timestamps: true })
export class Thesis {
  @Prop({ required: true, unique: true })
  code!: string;

  @Prop({ required: true, trim: true, maxlength: 300 })
  title!: string;

  @Prop({ trim: true, maxlength: 5000 })
  abstract?: string;

  @Prop({ type: [String], default: [] })
  keywords!: string[];

  @Prop({ type: ObjectId, ref: 'User', required: true })
  studentId!: Types.ObjectId;

  /** Denormalized "First Last" for sort=student and q regex search. */
  @Prop({ required: true })
  studentName!: string;

  @Prop({ type: ObjectId, ref: 'User', required: true })
  advisorId!: Types.ObjectId;

  @Prop({ type: [ObjectId], ref: 'User', default: [] })
  coAdvisorIds!: Types.ObjectId[];

  @Prop({ type: ObjectId, ref: 'Program', required: true })
  programId!: Types.ObjectId;

  @Prop({ type: ObjectId, ref: 'Cohort', required: true })
  cohortId!: Types.ObjectId;

  @Prop({ type: ObjectId, ref: 'Period', required: true })
  periodId!: Types.ObjectId;

  /** Only WorkflowService changes this after creation. */
  @Prop({
    type: String,
    enum: Object.values(ThesisStatus),
    required: true,
    default: ThesisStatus.SUBMITTED,
  })
  status!: ThesisStatus;

  @Prop({ required: true, min: 0, max: 100 })
  progress!: number;

  @Prop({ type: [ManuscriptVersionSchema], default: [] })
  manuscripts!: ManuscriptVersion[];

  /** Last manuscript version number; guards concurrent uploads. */
  @Prop({ default: 0 })
  manuscriptSeq!: number;

  @Prop({ type: ObjectId })
  currentManuscriptId?: Types.ObjectId;

  /** RN-01: documented conflicts in addition to advisor/co-advisors/student. */
  @Prop({ type: [ObjectId], ref: 'User', default: [] })
  conflictOfInterestUserIds!: Types.ObjectId[];

  @Prop({ type: [HistoryEntrySchema], default: [] })
  history!: HistoryEntry[];

  @Prop()
  seedTag?: string;
}

export type ThesisDocument = HydratedDocument<Thesis>;
export const ThesisSchema = applyJsonTransform(
  SchemaFactory.createForClass(Thesis),
);
ThesisSchema.index({ status: 1 });
ThesisSchema.index({ periodId: 1, cohortId: 1 });
ThesisSchema.index({ programId: 1 });
ThesisSchema.index({ studentId: 1 });
ThesisSchema.index({ seedTag: 1 });
ThesisSchema.index(
  { title: 'text', code: 'text' },
  { default_language: 'spanish' },
);
