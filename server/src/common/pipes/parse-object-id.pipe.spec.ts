import { ErrorCode } from '@thesis/shared';
import { AppException } from '../errors/app.exception';
import { ParseObjectIdPipe } from './parse-object-id.pipe';

describe('ParseObjectIdPipe', () => {
  const pipe = new ParseObjectIdPipe();

  it('returns a valid id lowercased', () => {
    expect(pipe.transform('65A1B2C3D4E5F60718293A4B')).toBe(
      '65a1b2c3d4e5f60718293a4b',
    );
  });

  it.each(['', 'abc', '65a1b2c3d4e5f60718293a4', 'zza1b2c3d4e5f60718293a4b'])(
    'rejects %p with VALIDATION_FAILED',
    (value) => {
      try {
        pipe.transform(value);
        fail('expected an exception');
      } catch (e) {
        expect(e).toBeInstanceOf(AppException);
        expect((e as AppException).code).toBe(ErrorCode.VALIDATION_FAILED);
        expect((e as AppException).getStatus()).toBe(400);
      }
    },
  );
});
