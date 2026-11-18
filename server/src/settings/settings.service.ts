import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import {
  Settings,
  SETTINGS_ID,
  SettingsDocument,
} from './schemas/settings.schema';

const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(Settings.name) private readonly model: Model<Settings>,
  ) {}

  /** The singleton, created with schema defaults on first use. */
  async get(): Promise<SettingsDocument> {
    const existing = await this.model.findById(SETTINGS_ID).exec();
    if (existing) return existing;
    try {
      return await this.model.create({ _id: SETTINGS_ID });
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
      return (await this.model.findById(SETTINGS_ID).exec())!;
    }
  }

  async holidaySet(): Promise<Set<string>> {
    return new Set((await this.get()).holidays);
  }

  async update(dto: UpdateSettingsDto): Promise<SettingsDocument> {
    await this.get();
    if (dto.holidays) dto = { ...dto, holidays: [...dto.holidays].sort() };
    const $set = Object.fromEntries(
      Object.entries(dto).filter(([, v]) => v !== undefined),
    );
    return (await this.model
      .findByIdAndUpdate(
        SETTINGS_ID,
        { $set },
        { new: true, runValidators: true },
      )
      .exec())!;
  }
}
