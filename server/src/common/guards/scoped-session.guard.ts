import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@thesis/shared';
import { ALLOW_SCOPED_KEY } from '../decorators/allow-scoped.decorator';
import { AppException } from '../errors/app.exception';
import { AuthUser } from '../types/auth-user';

/**
 * RF-J14 deny-by-default: a session carrying `scope.assignmentIds` (external-juror link)
 * may only reach handlers or controllers marked with `@AllowScoped()`.
 */
@Injectable()
export class ScopedSessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user?.scope) return true;
    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_SCOPED_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (allowed) return true;
    throw new AppException(
      ErrorCode.AUTH_EXTERNAL_TOKEN_INVALID,
      HttpStatus.UNAUTHORIZED,
      'Not available for an external access session',
    );
  }
}
