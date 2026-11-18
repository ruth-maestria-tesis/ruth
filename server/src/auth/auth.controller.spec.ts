import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

async function cookieOptionsFor(
  env: Record<string, string>,
): Promise<CookieOptions[]> {
  const config = {
    get: (key: string, fallback?: unknown) => env[key] ?? fallback,
  } as unknown as ConfigService;
  const auth = {
    accessTtlSeconds: 900,
    refreshTtlDays: 7,
    login: jest
      .fn()
      .mockResolvedValue({ user: {}, accessToken: 'a', refreshToken: 'r' }),
  } as unknown as AuthService;
  const controller = new AuthController(auth, {} as UsersService, config);
  const cookie = jest.fn<void, [string, string, CookieOptions]>();
  await controller.login({ email: 'x@test.edu.co', password: 'p' }, {
    cookie,
  } as unknown as Response);
  return cookie.mock.calls.map(([, , options]) => options);
}

describe('AuthController cookie options', () => {
  it.each([
    [{ NODE_ENV: 'development', COOKIE_SAME_SITE: 'lax' }, false],
    [{ NODE_ENV: 'production', COOKIE_SAME_SITE: 'lax' }, true],
    [{ NODE_ENV: 'development', COOKIE_SAME_SITE: 'none' }, true],
  ])('%j -> secure=%s', async (env, secure) => {
    const options = await cookieOptionsFor(env);
    expect(options).toHaveLength(2);
    for (const o of options) {
      expect(o.secure).toBe(secure);
      expect(o.httpOnly).toBe(true);
    }
  });
});
