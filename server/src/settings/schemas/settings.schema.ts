import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

export const SETTINGS_ID = 'global';

/** Singleton document with global deadlines and the holiday calendar (spec §5). */
@Schema({ collection: 'settings', timestamps: true })
export class Settings {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true, default: 8, min: 1, max: 60 })
  acceptanceBusinessDays!: number;

  @Prop({ required: true, default: 20, min: 1, max: 120 })
  evaluationBusinessDays!: number;

  @Prop({ required: true, default: 3, min: 1, max: 60 })
  unseenConceptAlertDays!: number;

  /** Deadline reminders go out when this many business days or fewer remain. */
  @Prop({ required: true, default: 2, min: 1, max: 10 })
  reminderBusinessDaysBefore!: number;

  /** Overdue-evaluation re-notification period in business days; 0 = notify only once. */
  @Prop({ required: true, default: 5, min: 0, max: 60 })
  overdueRenotifyBusinessDays!: number;

  /** 'YYYY-MM-DD' dates of the Bogotá calendar excluded from business days. */
  @Prop({ type: [String], default: [] })
  holidays!: string[];

  @Prop({ required: true, default: 'MIETIA', maxlength: 20 })
  thesisCodePrefix!: string;
}

export type SettingsDocument = HydratedDocument<Settings>;
export const SettingsSchema = applyJsonTransform(
  SchemaFactory.createForClass(Settings),
);
