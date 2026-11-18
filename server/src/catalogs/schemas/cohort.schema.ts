import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

/** "Corte": numbered intake of a program, tied to its entry period (sugerencia 4). */
@Schema({ timestamps: true })
export class Cohort {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Program', required: true })
  programId!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  number!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Period', required: true })
  periodId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 100 })
  name!: string;

  @Prop({ index: true })
  seedTag?: string;
}

export type CohortDocument = HydratedDocument<Cohort>;
export const CohortSchema = applyJsonTransform(
  SchemaFactory.createForClass(Cohort),
);
CohortSchema.index({ programId: 1, number: 1 }, { unique: true });
