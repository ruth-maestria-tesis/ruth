import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  AssignmentType,
  EvaluationStatus,
  EvaluationVerdict,
  StudentAccessType,
} from '@thesis/shared';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

const ObjectId = MongooseSchema.Types.ObjectId;

@Schema({ _id: false, id: false })
export class Rubric {
  @Prop({ min: 1, max: 5 })
  methodology?: number;

  @Prop({ min: 1, max: 5 })
  relevance?: number;

  @Prop({ min: 1, max: 5 })
  writingQuality?: number;
}
export const RubricSchema = SchemaFactory.createForClass(Rubric);

@Schema({ _id: false, id: false })
export class CorrectionFile {
  @Prop({ type: ObjectId, required: true })
  fileId!: Types.ObjectId;

  @Prop({ required: true })
  fileName!: string;

  @Prop({ required: true })
  uploadedAt!: Date;
}
export const CorrectionFileSchema =
  SchemaFactory.createForClass(CorrectionFile);

/** Sugerencia 9: when the student opened the evaluation or downloaded a correction. */
@Schema({ _id: false, id: false })
export class StudentAccess {
  @Prop({
    type: String,
    enum: Object.values(StudentAccessType),
    required: true,
  })
  type!: StudentAccessType;

  @Prop({ required: true })
  at!: Date;

  @Prop()
  ip?: string;
}
export const StudentAccessSchema = SchemaFactory.createForClass(StudentAccess);

@Schema({ timestamps: true })
export class Evaluation {
  @Prop({ type: ObjectId, ref: 'Assignment', required: true })
  assignmentId!: Types.ObjectId;

  @Prop({ type: ObjectId, ref: 'Thesis', required: true })
  thesisId!: Types.ObjectId;

  @Prop({ type: ObjectId, ref: 'User', required: true })
  jurorId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(AssignmentType), required: true })
  assignmentType!: AssignmentType;

  @Prop({ type: RubricSchema })
  rubric?: Rubric;

  /** Average of the rubric; set only when the rubric is complete. */
  @Prop()
  score?: number;

  @Prop({ type: String, enum: Object.values(EvaluationVerdict) })
  verdict?: EvaluationVerdict;

  @Prop({ default: '', maxlength: 10000 })
  comments!: string;

  @Prop({ type: [CorrectionFileSchema], default: [] })
  correctionFiles!: CorrectionFile[];

  @Prop({
    type: String,
    enum: Object.values(EvaluationStatus),
    required: true,
    default: EvaluationStatus.DRAFT,
  })
  status!: EvaluationStatus;

  @Prop()
  submittedAt?: Date;

  @Prop()
  studentFirstViewedAt?: Date;

  @Prop()
  studentFirstDownloadedAt?: Date;

  @Prop({ type: [StudentAccessSchema], default: [] })
  studentAccessLog!: StudentAccess[];

  @Prop()
  unseenAlertSentAt?: Date;

  @Prop()
  seedTag?: string;
}

export type EvaluationDocument = HydratedDocument<Evaluation>;
export const EvaluationSchema = applyJsonTransform(
  SchemaFactory.createForClass(Evaluation),
  ['studentAccessLog'],
);
EvaluationSchema.index({ assignmentId: 1 }, { unique: true });
EvaluationSchema.index({ thesisId: 1 });
