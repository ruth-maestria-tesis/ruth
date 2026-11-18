import { buildSort } from './paginate';

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
