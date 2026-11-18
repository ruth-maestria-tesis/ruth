import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, Role } from '@thesis/shared';
import { AppException } from '../errors/app.exception';
import { RolesGuard } from './roles.guard';

function contextWith(user?: { roles: Role[] }): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  afterEach(() => jest.restoreAllMocks());

  it('allows routes without @Roles metadata', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextWith())).toBe(true);
  });

  it('allows a user holding one of the required roles', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Role.ADMIN, Role.COORDINATOR]);
    expect(guard.canActivate(contextWith({ roles: [Role.COORDINATOR] }))).toBe(
      true,
    );
  });

  it('rejects a user without the required roles with AUTH_FORBIDDEN', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    try {
      guard.canActivate(contextWith({ roles: [Role.STUDENT] }));
      fail('expected AppException');
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      expect((e as AppException).code).toBe(ErrorCode.AUTH_FORBIDDEN);
      expect((e as AppException).getStatus()).toBe(403);
    }
  });
});
