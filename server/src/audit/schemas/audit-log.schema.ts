import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { applyJsonTransform } from '../../common/mongoose/json-transform';

const ObjectId = MongooseSchema.Types.ObjectId;

/** Insert-only (RNF-04): there is no update or delete path, and the hooks below enforce it. */
@Schema({ collection: 'auditLogs', versionKey: false })
export class AuditLog {
  @Prop({ required: true, default: () => new Date() })
  at!: Date;

  @Prop({ type: ObjectId })
  actorId?: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  actorRoles!: string[];

  /** Route pattern ("POST /theses/:id/assignments") or an explicit event (AUTH_LOGIN_FAILURE). */
  @Prop({ required: true })
  action!: string;

  @Prop()
  method?: string;

  /** Concrete request path, without the query string. */
  @Prop()
  path?: string;

  @Prop()
  entityType?: string;

  @Prop()
  entityId?: string;

  @Prop()
  statusCode?: number;

  @Prop()
  ip?: string;

  @Prop()
  userAgent?: string;

  /** Allow-listed safe fields only; never request bodies. */
  @Prop({ type: MongooseSchema.Types.Mixed })
  meta?: Record<string, unknown>;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;

const FORBIDDEN_QUERY_OPS = [
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
] as const;

const immutable = () => {
  throw new Error('auditLogs is insert-only');
};

const schema = SchemaFactory.createForClass(AuditLog);
schema.index({ at: -1 });
schema.index({ entityType: 1, entityId: 1 });
schema.index({ actorId: 1, at: -1 });
schema.pre([...FORBIDDEN_QUERY_OPS], immutable);
schema.pre('deleteOne', { document: true, query: false }, immutable);
schema.pre('updateOne', { document: true, query: false }, immutable);
schema.pre('save', function () {
  if (!this.isNew) immutable();
});

export const AuditLogSchema = applyJsonTransform(schema);
