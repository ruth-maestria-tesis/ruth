import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode, Role } from '@thesis/shared';
import { ACCESS_COOKIE } from '../../auth/auth.constants';
import type { UsersService } from '../../users/users.service';
import { AppException } from '../errors/app.exception';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'a-very-long-test-secret-of-32-chars-minimum!!';

type Req = {
  cookies?: Record<string, string>;
  headers: Record<string, string>;
  user?: unknown;
};

function contextWith(req: Req): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const b64url = (o: object) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');

describe('JwtAuthGuard', () => {
  const reflector = new Reflector();
  const jwt = new JwtService();
  const config = {
    getOrThrow: (key: string) => {
      if (key === 'JWT_ACCESS_SECRET') return SECRET;
      throw new Error(`unexpected key ${key}`);
    },
  } as unknown as ConfigService;
  const isActive = jest.fn<Promise<boolean>, [string]>();
  const users = { isActive } as unknown as UsersService;
  const guard = new JwtAuthGuard(reflector, jwt, config, users);
  const payload = {
    sub: 'u1',
    email: 'a@b.co',
    roles: [Role.ADMIN],
    scope: 'full',
  };

  beforeEach(() => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    isActive.mockReset().mockResolvedValue(true);
  });
  afterEach(() => jest.restoreAllMocks());

  async function expectUnauthenticated(req: Req) {
    let error: unknown;
    try {
      await guard.canActivate(contextWith(req));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe(ErrorCode.AUTH_UNAUTHENTICATED);
    expect((error as AppException).getStatus()).toBe(401);
  }

  it('accepts a valid token from the access cookie and sets req.user', async () => {
    const token = await jwt.signAsync(payload, { secret: SECRET });
    const req: Req = { cookies: { [ACCESS_COOKIE]: token }, headers: {} };
    await expect(guard.canActivate(contextWith(req))).resolves.toBe(true);
    expect(req.user).toEqual({
      id: 'u1',
      email: 'a@b.co',
      roles: [Role.ADMIN],
      scope: 'full',
    });
  });

  it('accepts a valid Authorization Bearer token', async () => {
    const token = await jwt.signAsync(payload, { secret: SECRET });
    const req: Req = { headers: { authorization: `Bearer ${token}` } };
    await expect(guard.canActivate(contextWith(req))).resolves.toBe(true);
    expect((req.user as { id: string }).id).toBe('u1');
  });

  it('rejects a missing token', async () => {
    await expectUnauthenticated({ cookies: {}, headers: {} });
  });

  it('rejects an expired token', async () => {
    const token = await jwt.signAsync(payload, {
      secret: SECRET,
      expiresIn: -10,
    });
    await expectUnauthenticated({
      cookies: { [ACCESS_COOKIE]: token },
      headers: {},
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await jwt.signAsync(payload, {
      secret: 'another-secret-that-is-also-32-chars-long!!',
    });
    await expectUnauthenticated({
      cookies: { [ACCESS_COOKIE]: token },
      headers: {},
    });
  });

  it('rejects an unsigned token with alg none', async () => {
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.`;
    await expectUnauthenticated({
      cookies: { [ACCESS_COOKIE]: token },
      headers: {},
    });
  });

  it('rejects a token signed with a non-HS256 algorithm', async () => {
    const token = await jwt.signAsync(payload, {
      secret: SECRET,
      algorithm: 'HS512',
    });
    await expectUnauthenticated({
      cookies: { [ACCESS_COOKIE]: token },
      headers: {},
    });
  });

  it('rejects a valid token of an inactive or deleted user', async () => {
    isActive.mockResolvedValue(false);
    const token = await jwt.signAsync(payload, { secret: SECRET });
    await expectUnauthenticated({
      cookies: { [ACCESS_COOKIE]: token },
      headers: {},
    });
    expect(isActive).toHaveBeenCalledWith('u1');
  });

  it('lets @Public() routes through without a token', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    await expect(
      guard.canActivate(contextWith({ cookies: {}, headers: {} })),
    ).resolves.toBe(true);
  });
});
