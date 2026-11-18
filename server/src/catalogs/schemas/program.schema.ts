import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ProgramLevel } from '@thesis/shared';
import { HydratedDocument } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

@Schema({ timestamps: true })
export class Program {
  /** Used as the thesis code prefix (e.g. MIETIA-2026-II-001). */
  @Prop({
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    maxlength: 20,
  })
  code!: string;

  @Prop({ required: true, trim: true, maxlength: 200 })
  name!: string;

  @Prop({ type: String, enum: Object.values(ProgramLevel), required: true })
  level!: ProgramLevel;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ index: true })
  seedTag?: string;
}

export type ProgramDocument = HydratedDocument<Program>;
export const ProgramSchema = applyJsonTransform(
  SchemaFactory.createForClass(Program),
);
