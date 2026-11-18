import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Role } from '@thesis/shared';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ _id: false })
export class JurorProfile {
  @Prop({ required: true, trim: true })
  institution!: string;

  /** RF-C13: at least one assigned juror must belong to Universidad de Córdoba. */
  @Prop({ required: true, default: false })
  isUnicordoba!: boolean;

  @Prop({ trim: true })
  highestDegree?: string;

  @Prop({ trim: true })
  country?: string;

  @Prop({ type: [String], default: [] })
  expertise!: string[];
}
export const JurorProfileSchema = SchemaFactory.createForClass(JurorProfile);

@Schema({ _id: false })
export class StudentProfile {
  @Prop({ required: true, trim: true })
  studentCode!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  programId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  cohortId?: Types.ObjectId;
}
export const StudentProfileSchema =
  SchemaFactory.createForClass(StudentProfile);

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret._id;
      delete ret.__v;
      delete ret.passwordHash;
      return ret;
    },
  },
})
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  /** Absent for external jurors (they use token access, RF-J14). */
  @Prop({ select: false })
  passwordHash?: string;

  @Prop({ required: true, trim: true })
  firstName!: string;

  @Prop({ required: true, trim: true })
  lastName!: string;

  @Prop({ trim: true })
  documentId?: string;

  @Prop({ type: [String], enum: Object.values(Role), required: true })
  roles!: Role[];

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ type: JurorProfileSchema })
  jurorProfile?: JurorProfile;

  @Prop({ type: StudentProfileSchema })
  studentProfile?: StudentProfile;

  @Prop({ index: true })
  seedTag?: string;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ roles: 1, isActive: 1 });
