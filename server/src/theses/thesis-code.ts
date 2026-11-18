import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Counter } from './schemas/counter.schema';

export function codePrefix(
  programCode: string,
  periodCode: string,
  seedTag?: string,
): string {
  const base = `${programCode}-${periodCode}`;
  return seedTag ? `${seedTag}-${base}` : base;
}

export function formatThesisCode(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

@Injectable()
export class ThesisCodeService {
  constructor(
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
  ) {}

  /** Atomic per-prefix sequence: concurrent registrations never share a number. */
  async next(
    programCode: string,
    periodCode: string,
    seedTag?: string,
  ): Promise<string> {
    const prefix = codePrefix(programCode, periodCode, seedTag);
    const counter = await this.counters.findOneAndUpdate(
      { _id: `thesis:${prefix}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return formatThesisCode(prefix, counter.seq);
  }
}
