import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Named monotonic sequences, e.g. `thesis:MIETIA-2026-II`. */
@Schema({ collection: 'counters', versionKey: false })
export class Counter {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true, default: 0 })
  seq!: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
