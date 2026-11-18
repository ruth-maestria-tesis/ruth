import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  FilterQuery,
  HydratedDocument,
  Model,
  Schema as MongooseSchema,
  Types,
} from 'mongoose';

@Schema({ timestamps: true, collection: 'refreshTokens' })
export class RefreshToken {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  /** SHA-256 of the signed refresh JWT; the raw token is never stored. */
  @Prop({ required: true, unique: true })
  tokenHash!: string;

  /** All tokens issued from one login share a family; reuse of a rotated token revokes the family. */
  @Prop({ required: true, index: true })
  familyId!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop()
  revokedAt?: Date;

  @Prop()
  replacedBy?: string;

  /**
   * Set on every token of a family when the family is revoked (reuse, logout, deactivation...).
   * An in-flight rotation checks it after creating its new token, so a token inserted
   * concurrently with a revocation cannot survive it (see AuthService.refresh).
   */
  @Prop()
  familyRevokedAt?: Date;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Revokes every refresh token matching `filter` (e.g. `{ familyId }` or `{ userId }`).
 * Two phases: first flag the matched families, then revoke. A concurrent rotation that
 * inserts a new token either sees the flag (and revokes its own token) or is inserted
 * before phase 2 starts (and is revoked by it).
 * Shared by AuthModule and UsersModule so UsersModule does not depend on AuthModule.
 */
export async function revokeRefreshTokens(
  model: Model<RefreshToken>,
  filter: FilterQuery<RefreshToken>,
): Promise<void> {
  const now = new Date();
  await model.updateMany(filter, { $set: { familyRevokedAt: now } });
  await model.updateMany(
    { ...filter, revokedAt: null },
    { $set: { revokedAt: now } },
  );
}
