import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { ACCESS_COOKIE } from '../auth/auth.constants';
import type { AccessTokenPayload, AuthUser } from '../common/types/auth-user';
import { AuditEntry, AuditService } from './audit.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Body fields that are safe to keep. Anything else (passwords, tokens, free text) is dropped. */
export const META_ALLOW_LIST = [
  'to',
  'verdict',
  'status',
  'decision',
  'modality',
  'type',
  'isActive',
  'role',
  'roles',
] as const;

const MAX_META_STRING = 100;

type Meta = Record<string, unknown>;

function safeValue(v: unknown): unknown {
  if (typeof v === 'string') return v.slice(0, MAX_META_STRING);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string'))
    return v.slice(0, 10).map((x: string) => x.slice(0, MAX_META_STRING));
  return undefined;
}

export function pickMeta(body: unknown): Meta | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const out: Meta = {};
  for (const key of META_ALLOW_LIST) {
    const v = safeValue((body as Meta)[key]);
    if (v !== undefined) out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** "/api/theses/:id/assignments" → "/theses/:id/assignments" (the route pattern, not the URL). */
export function routePattern(req: Request): string {
  const raw = (req.route as { path?: string } | undefined)?.path ?? req.path;
  return raw.replace(/^\/api(?=\/|$)/, '') || '/';
}

/** The first static segment is the resource; its id is the first route param. */
export function entityFrom(
  pattern: string,
  params: Record<string, unknown>,
  responseBody: unknown,
): { entityType?: string; entityId?: string } {
  const entityType = pattern.split('/').find((s) => s && !s.startsWith(':'));
  const paramId = params.id ?? Object.values(params)[0];
  let entityId = typeof paramId === 'string' ? paramId : undefined;
  if (!entityId && responseBody && typeof responseBody === 'object') {
    const id = (responseBody as { id?: unknown }).id;
    if (typeof id === 'string') entityId = id;
  }
  return { entityType, entityId };
}

interface RequestWithUser extends Request {
  user?: AuthUser;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const http = ctx.switchToHttp();
    const req = http.getRequest<RequestWithUser>();
    const res = http.getResponse<Response>();
    if (!MUTATING.has(req.method)) return next.handle();

    return next.handle().pipe(
      tap({
        next: (body) => this.onSuccess(req, res, body),
        error: (err: unknown) => this.onError(req, err),
      }),
    );
  }

  private base(req: RequestWithUser): Omit<AuditEntry, 'action'> {
    return {
      method: req.method,
      path: req.originalUrl.split('?')[0],
      ip: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 300),
    };
  }

  private onSuccess(req: RequestWithUser, res: Response, body: unknown): void {
    try {
      const pattern = routePattern(req);
      const base = this.base(req);
      const action = `${req.method} ${pattern}`;

      if (action === 'POST /auth/login') {
        const user = (body as { user?: AuthUser } | undefined)?.user;
        this.audit.record({
          ...base,
          action: 'AUTH_LOGIN_SUCCESS',
          actorId: user?.id,
          actorRoles: user?.roles ?? [],
          entityType: 'auth',
          statusCode: res.statusCode,
        });
        return;
      }
      if (action === 'POST /auth/logout') {
        const actor = this.actorFromCookie(req);
        this.audit.record({
          ...base,
          action: 'AUTH_LOGOUT',
          actorId: actor?.sub,
          actorRoles: actor?.roles ?? [],
          entityType: 'auth',
          statusCode: res.statusCode,
        });
        return;
      }

      // Public endpoints (refresh, external token exchange) have no authenticated user.
      if (!req.user) return;
      this.audit.record({
        ...base,
        action,
        actorId: req.user.id,
        actorRoles: req.user.roles,
        ...entityFrom(pattern, req.params, body),
        statusCode: res.statusCode,
        meta: pickMeta(req.body),
      });
    } catch {
      // Auditing must never break the request.
    }
  }

  private onError(req: RequestWithUser, err: unknown): void {
    try {
      if (`${req.method} ${routePattern(req)}` !== 'POST /auth/login') return;
      const email = (req.body as { email?: unknown } | undefined)?.email;
      this.audit.record({
        ...this.base(req),
        action: 'AUTH_LOGIN_FAILURE',
        entityType: 'auth',
        statusCode: err instanceof HttpException ? err.getStatus() : 500,
        // Only the attempted e-mail; the password is never read.
        meta:
          typeof email === 'string'
            ? { email: email.slice(0, 200) }
            : undefined,
      });
    } catch {
      // Auditing must never break the request.
    }
  }

  /** Logout is public, so the actor comes from the (still valid) access cookie when present. */
  private actorFromCookie(req: Request): AccessTokenPayload | undefined {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      ACCESS_COOKIE
    ];
    if (!token) return undefined;
    try {
      return this.jwt.verify<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        algorithms: ['HS256'],
      });
    } catch {
      return undefined;
    }
  }
}
