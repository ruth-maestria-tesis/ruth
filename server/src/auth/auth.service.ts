import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode } from '@thesis/shared';
import { randomUUID } from 'node:crypto';
import { Model } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { sha256 } from '../common/security/hash';
import { verifyPassword } from '../common/security/password';
import { AccessTokenPayload } from '../common/types/auth-user';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './schemas/refresh-token.schema';

interface RefreshTokenPayload {
  sub: string;
  fid: string;
  jti: string;
}

export interface SessionResult {
  user: UserDocument;
  accessToken: string;
  refreshToken: string;
}

const refreshInvalid = () =>
  new AppException(
    ErrorCode.AUTH_REFRESH_INVALID,
    HttpStatus.UNAUTHORIZED,
    'Invalid refresh token',
  );

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectModel(RefreshToken.name)
    private readonly refreshTokens: Model<RefreshToken>,
  ) {}

  get accessTtlSeconds(): number {
    return Number(this.config.get('JWT_ACCESS_TTL_SECONDS', 900));
  }

  get refreshTtlDays(): number {
    return Number(this.config.get('JWT_REFRESH_TTL_DAYS', 7));
  }

  async login(email: string, password: string): Promise<SessionResult> {
    const user = await this.users.findByEmailWithPassword(email);
    if (
      !user?.passwordHash ||
      !(await verifyPassword(password, user.passwordHash))
    ) {
      throw new AppException(
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        HttpStatus.UNAUTHORIZED,
        'Invalid credentials',
      );
    }
    if (!user.isActive) {
      throw new AppException(
        ErrorCode.AUTH_USER_INACTIVE,
        HttpStatus.FORBIDDEN,
        'User is inactive',
      );
    }
    return { user, ...(await this.issueTokens(user, randomUUID())) };
  }

  async refresh(token: string | undefined): Promise<SessionResult> {
    if (!token) throw refreshInvalid();
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw refreshInvalid();
    }

    const stored = await this.refreshTokens.findOne({
      tokenHash: sha256(token),
    });
    if (!stored || stored.revokedAt) {
      // A rotated or unknown token was presented: treat as theft and revoke the whole family.
      await this.revokeFamily(payload.fid);
      throw refreshInvalid();
    }

    const user = await this.users.findById(payload.sub).catch(() => null);
    if (!user) throw refreshInvalid();
    if (!user.isActive) {
      await this.revokeFamily(stored.familyId);
      throw new AppException(
        ErrorCode.AUTH_USER_INACTIVE,
        HttpStatus.FORBIDDEN,
        'User is inactive',
      );
    }

    const tokens = await this.issueTokens(user, stored.familyId);
    stored.revokedAt = new Date();
    stored.replacedBy = sha256(tokens.refreshToken);
    await stored.save();
    return { user, ...tokens };
  }

  /** Always succeeds: an expired or malformed cookie must not block logging out. */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const payload = this.jwt.decode<RefreshTokenPayload | null>(token);
    if (payload?.fid) await this.revokeFamily(payload.fid);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.users.findByIdWithPassword(userId);
    if (
      !user.passwordHash ||
      !(await verifyPassword(currentPassword, user.passwordHash))
    ) {
      throw new AppException(
        ErrorCode.AUTH_WRONG_PASSWORD,
        HttpStatus.BAD_REQUEST,
        'Current password is incorrect',
      );
    }
    await this.users.setPassword(userId, newPassword);
    await this.refreshTokens.updateMany(
      { userId: user._id, revokedAt: null },
      { revokedAt: new Date() },
    );
  }

  private async issueTokens(
    user: UserDocument,
    familyId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id as string,
      email: user.email,
      roles: user.roles,
    };
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.accessTtlSeconds,
    });

    const refreshPayload: RefreshTokenPayload = {
      sub: user.id as string,
      fid: familyId,
      jti: randomUUID(),
    };
    const refreshSeconds = this.refreshTtlDays * 86_400;
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshSeconds,
    });

    await this.refreshTokens.create({
      userId: user._id,
      tokenHash: sha256(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + refreshSeconds * 1000),
    });
    return { accessToken, refreshToken };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokens.updateMany(
      { familyId, revokedAt: null },
      { revokedAt: new Date() },
    );
  }
}
