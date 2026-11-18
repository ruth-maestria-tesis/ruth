import type {
  FilterQuery,
  HydratedDocument,
  Model,
  ProjectionType,
  mongo,
  SortOrder,
} from 'mongoose';
import { Paginated, PaginationQueryDto } from './pagination.dto';

/** API sort key → document path. Only whitelisted keys are sortable (sugerencia 6). */
export type SortFields = Readonly<Record<string, string>>;

export function buildSort(
  query: Pick<PaginationQueryDto, 'sort' | 'order'>,
  fields: SortFields,
  defaultField: string,
): Record<string, SortOrder> {
  const dir: SortOrder = query.order === 'desc' ? -1 : 1;
  const field =
    query.sort && Object.hasOwn(fields, query.sort)
      ? fields[query.sort]
      : defaultField;
  // _id makes the order total, so pages never repeat or skip documents on ties.
  return { [field]: dir, _id: dir };
}

export async function paginate<T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  query: PaginationQueryDto,
  options: {
    sortFields: SortFields;
    defaultSort: string;
    projection?: ProjectionType<T>;
    /** e.g. `{ locale: 'es', strength: 1 }` for accent/case-insensitive ordering. */
    collation?: mongo.CollationOptions;
  },
): Promise<Paginated<HydratedDocument<T>>> {
  const find = model
    .find(filter, options.projection)
    .sort(buildSort(query, options.sortFields, options.defaultSort))
    .skip((query.page - 1) * query.limit)
    .limit(query.limit);
  const count = model.countDocuments(filter);
  if (options.collation) {
    find.collation(options.collation);
    count.collation(options.collation);
  }
  const [items, total] = await Promise.all([find.exec(), count.exec()]);
  return {
    items: items as HydratedDocument<T>[],
    total,
    page: query.page,
    limit: query.limit,
  };
}
