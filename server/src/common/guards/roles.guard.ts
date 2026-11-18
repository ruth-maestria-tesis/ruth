import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, Role } from '@thesis/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppException } from '../errors/app.exception';
import { AuthUser } from '../types/auth-user';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required?.length) return true;
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || !required.some((role) => user.roles.includes(role))) {
      throw new AppException(
        ErrorCode.AUTH_FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'Insufficient role',
      );
    }
    return true;
  }
}
