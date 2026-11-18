import type { Schema } from 'mongoose';

/**
 * Uniform API shape for every collection: `id` instead of `_id`, no `__v`, and the
 * given fields removed. Subdocument schemas must declare `{ _id: false, id: false }`.
 */
export function applyJsonTransform<S extends Schema>(
  schema: S,
  hiddenFields: readonly string[] = [],
): S {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret._id;
      for (const field of hiddenFields) delete ret[field];
      return ret;
    },
  });
  return schema;
}
