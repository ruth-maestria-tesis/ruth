import { envValidationSchema } from './env.validation';

const base = {
  MONGODB_URI: 'mongodb://localhost:27017/thesis',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('envValidationSchema', () => {
  it('requires NODE_ENV (no silent development default)', () => {
    const { error } = envValidationSchema.validate(base);
    expect(error?.message).toContain('"NODE_ENV" is required');
  });

  it('accepts a valid NODE_ENV', () => {
    const result = envValidationSchema.validate({
      ...base,
      NODE_ENV: 'production',
    });
    expect(result.error).toBeUndefined();
    expect((result.value as { NODE_ENV: string }).NODE_ENV).toBe('production');
  });

  it('defaults the external juror link settings', () => {
    const result = envValidationSchema.validate({
      ...base,
      NODE_ENV: 'test',
    });
    const value = result.value as {
      EXTERNAL_TOKEN_TTL_DAYS: number;
      EXTERNAL_SESSION_TTL_SECONDS: number;
    };
    expect(value.EXTERNAL_TOKEN_TTL_DAYS).toBe(60);
    expect(value.EXTERNAL_SESSION_TTL_SECONDS).toBe(14400);
  });

  it('defaults STORAGE_DRIVER to gridfs and needs the Blob token for vercel-blob', () => {
    const env = { ...base, NODE_ENV: 'test' };
    const value = envValidationSchema.validate(env).value as {
      STORAGE_DRIVER: string;
    };
    expect(value.STORAGE_DRIVER).toBe('gridfs');
    expect(
      envValidationSchema.validate({ ...env, STORAGE_DRIVER: 'vercel-blob' })
        .error?.message,
    ).toContain('"BLOB_READ_WRITE_TOKEN" is required');
    expect(
      envValidationSchema.validate({
        ...env,
        STORAGE_DRIVER: 'vercel-blob',
        BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x',
      }).error,
    ).toBeUndefined();
    expect(
      envValidationSchema.validate({ ...env, STORAGE_DRIVER: 's3' }).error,
    ).toBeDefined();
  });
});
