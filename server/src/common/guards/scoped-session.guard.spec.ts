import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, Role } from '@thesis/shared';
import { AppException } from '../errors/app.exception';
import { AuthUser } from '../types/auth-user';
import { ScopedSessionGuard } from './scoped-session.guard';

function contextWith(user?: AuthUser): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('ScopedSessionGuard', () => {
  const reflector = new Reflector();
  const guard = new ScopedSessionGuard(reflector);
  const full: AuthUser = { id: 'u', email: 'a@b.co', roles: [Role.STUDENT] };
  const scoped: AuthUser = {
    id: 'j',
    email: 'j@b.co',
    roles: [Role.EXTERNAL_JUROR],
    scope: { assignmentIds: ['a1'] },
  };

  afterEach(() => jest.restoreAllMocks());

  it('lets unscoped sessions and anonymous requests through', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextWith(full))).toBe(true);
    expect(guard.canActivate(contextWith(undefined))).toBe(true);
  });

  it('lets a scoped session reach @AllowScoped() routes', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    expect(guard.canActivate(contextWith(scoped))).toBe(true);
  });

  it('rejects a scoped session elsewhere with 401 AUTH_EXTERNAL_TOKEN_INVALID', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    let error: unknown;
    try {
      guard.canActivate(contextWith(scoped));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe(
      ErrorCode.AUTH_EXTERNAL_TOKEN_INVALID,
    );
    expect((error as AppException).getStatus()).toBe(401);
  });
});
