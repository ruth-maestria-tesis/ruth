import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PeriodTerm } from '@thesis/shared';
import { HydratedDocument } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

@Schema({ timestamps: true })
export class Period {
  /** `${year}-${term}`, e.g. 2026-II. Set by CatalogsService, immutable. */
  @Prop({ required: true, unique: true })
  code!: string;

  @Prop({ required: true, min: 2000, max: 2100 })
  year!: number;

  @Prop({ type: String, enum: Object.values(PeriodTerm), required: true })
  term!: PeriodTerm;

  @Prop({ required: true })
  startsAt!: Date;

  @Prop({ required: true })
  endsAt!: Date;

  @Prop({ index: true })
  seedTag?: string;
}

export type PeriodDocument = HydratedDocument<Period>;
export const PeriodSchema = applyJsonTransform(
  SchemaFactory.createForClass(Period),
);
