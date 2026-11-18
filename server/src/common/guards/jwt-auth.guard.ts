import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '@thesis/shared';
import type { Request } from 'express';
import { ACCESS_COOKIE } from '../../auth/auth.constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppException } from '../errors/app.exception';
import { AccessTokenPayload, AuthUser } from '../types/auth-user';

function extractAccessToken(req: Request): string | undefined {
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[
    ACCESS_COOKIE
  ];
  if (fromCookie) return fromCookie;
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  return scheme === 'Bearer' && token ? token : undefined;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = extractAccessToken(req);
    if (!token)
      throw new AppException(
        ErrorCode.AUTH_UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        'Missing token',
      );

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        algorithms: ['HS256'],
      });
      req.user = {
        id: payload.sub,
        email: payload.email,
        roles: payload.roles,
        scope: payload.scope,
      };
      return true;
    } catch {
      throw new AppException(
        ErrorCode.AUTH_UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        'Invalid or expired token',
      );
    }
  }
}
