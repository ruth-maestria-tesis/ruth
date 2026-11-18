import type { Model } from 'mongoose';
import { buildSort, paginate } from './paginate';

describe('buildSort', () => {
  const fields = { code: 'code', student: 'studentName' };

  it('maps the API field to the DB field and adds an _id tie-breaker', () => {
    expect(
      buildSort({ sort: 'student', order: 'desc' }, fields, 'code'),
    ).toEqual({ studentName: -1, _id: -1 });
  });

  it('falls back to the default field for unknown or missing sort keys', () => {
    expect(
      buildSort({ sort: 'passwordHash', order: 'asc' }, fields, 'code'),
    ).toEqual({ code: 1, _id: 1 });
    expect(buildSort({ order: 'asc' }, fields, 'code')).toEqual({
      code: 1,
      _id: 1,
    });
  });
});

describe('paginate collation', () => {
  const makeModel = () => {
    const query = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      collation: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const count = {
      collation: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(0),
    };
    const model = {
      find: jest.fn().mockReturnValue(query),
      countDocuments: jest.fn().mockReturnValue(count),
    };
    return { model: model as unknown as Model<unknown>, query, count };
  };
  const opts = { sortFields: { code: 'code' }, defaultSort: 'code' };
  const q = { page: 1, limit: 10, order: 'asc' as const };

  it('applies the collation to find and countDocuments when given', async () => {
    const { model, query, count } = makeModel();
    const collation = { locale: 'es', strength: 1 };
    await paginate(model, {}, q, { ...opts, collation });
    expect(query.collation).toHaveBeenCalledWith(collation);
    expect(count.collation).toHaveBeenCalledWith(collation);
  });

  it('does not set a collation by default', async () => {
    const { model, query, count } = makeModel();
    await paginate(model, {}, q, opts);
    expect(query.collation).not.toHaveBeenCalled();
    expect(count.collation).not.toHaveBeenCalled();
  });
});
