import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode, isExternalOnly, Role } from '@thesis/shared';
import { AssignmentsService } from '../assignments/assignments.service';
import { AppException } from '../common/errors/app.exception';
import { sha256 } from '../common/security/hash';
import type { AccessTokenPayload } from '../common/types/auth-user';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';

const invalidToken = () =>
  new AppException(
    ErrorCode.AUTH_EXTERNAL_TOKEN_INVALID,
    HttpStatus.UNAUTHORIZED,
    'Invalid or expired access link',
  );

/** RF-J14: an external juror's link token → short session scoped to one assignment. */
@Injectable()
export class ExternalAuthService {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  get sessionTtlSeconds(): number {
    return Number(this.config.get('EXTERNAL_SESSION_TTL_SECONDS', 14_400));
  }

  /** Session lifetime: the configured TTL, never past the link's own expiry. */
  sessionTtlFor(linkExpiresAt: Date | undefined, now = new Date()): number {
    const ttl = this.sessionTtlSeconds;
    if (!linkExpiresAt) return ttl;
    const remaining = Math.floor(
      (linkExpiresAt.getTime() - now.getTime()) / 1000,
    );
    return Math.max(0, Math.min(ttl, remaining));
  }

  async exchange(token: string): Promise<{
    user: UserDocument;
    assignmentId: string;
    accessToken: string;
    expiresInSeconds: number;
  }> {
    const assignment = await this.assignments.findByExternalTokenHash(
      sha256(token),
    );
    if (!assignment) throw invalidToken();
    const user = await this.users
      .findById(assignment.jurorId.toHexString())
      .catch(() => null);
    if (!user?.isActive || !isExternalOnly(user.roles)) throw invalidToken();
    const expiresInSeconds = this.sessionTtlFor(
      assignment.externalTokenExpiresAt,
    );
    if (expiresInSeconds <= 0) throw invalidToken();
    const assignmentId = assignment.id as string;
    const payload: AccessTokenPayload = {
      sub: user.id as string,
      email: user.email,
      roles: [Role.EXTERNAL_JUROR],
      scope: { assignmentIds: [assignmentId] },
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: expiresInSeconds,
    });
    return { user, assignmentId, accessToken, expiresInSeconds };
  }
}
