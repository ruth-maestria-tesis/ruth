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
});
