import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '@thesis/shared';
import { Model, Types } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { sha256 } from '../common/security/hash';
import { verifyPasswordOrDummy } from '../common/security/password';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { RefreshToken } from './schemas/refresh-token.schema';

jest.mock('../common/security/password', () => {
  const actual = jest.requireActual<
    typeof import('../common/security/password')
  >('../common/security/password');
  return {
    ...actual,
    verifyPasswordOrDummy: jest.fn(actual.verifyPasswordOrDummy),
  };
});

const verifyMock = jest.mocked(verifyPasswordOrDummy);

const config = {
  get: (_key: string, fallback?: unknown) => fallback,
  getOrThrow: (key: string) => `${key}-test-secret`,
} as unknown as ConfigService;

function buildService(overrides: {
  users?: Partial<UsersService>;
  jwt?: Partial<JwtService>;
  refreshTokens?: Record<string, jest.Mock>;
}): AuthService {
  return new AuthService(
    (overrides.users ?? {}) as UsersService,
    (overrides.jwt ?? {}) as JwtService,
    config,
    (overrides.refreshTokens ?? {}) as unknown as Model<RefreshToken>,
  );
}

async function expectCode(promise: Promise<unknown>, code: ErrorCode) {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
}

describe('AuthService.login', () => {
  beforeEach(() => verifyMock.mockClear());

  it('runs the constant-time check for an unknown email', async () => {
    const service = buildService({
      users: { findByEmailWithPassword: jest.fn().mockResolvedValue(null) },
    });
    await expectCode(
      service.login('nobody@test.edu.co', 'Password123!'),
      ErrorCode.AUTH_INVALID_CREDENTIALS,
    );
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(verifyMock).toHaveBeenCalledWith('Password123!', undefined);
  });

  it('runs the constant-time check for a user without password hash', async () => {
    const juror = { isActive: true, passwordHash: undefined };
    const service = buildService({
      users: { findByEmailWithPassword: jest.fn().mockResolvedValue(juror) },
    });
    await expectCode(
      service.login('juror@test.edu.co', 'Password123!'),
      ErrorCode.AUTH_INVALID_CREDENTIALS,
    );
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(verifyMock).toHaveBeenCalledWith('Password123!', undefined);
  });
});

describe('AuthService.refresh', () => {
  it('revokes the new token and fails when the family was revoked during rotation', async () => {
    const userId = new Types.ObjectId();
    const user = {
      _id: userId,
      id: userId.toHexString(),
      email: 'user@test.edu.co',
      roles: [],
      isActive: true,
    } as unknown as UserDocument;
    const refreshTokens = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ familyId: 'family-1' }),
      create: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockResolvedValue({}),
      // The post-insert re-check reports a flagged family (a concurrent revocation won).
      exists: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    };
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: user.id as string,
        fid: 'family-1',
        jti: 'jti-1',
      }),
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token'),
    };
    const service = buildService({
      users: { findById: jest.fn().mockResolvedValue(user) },
      jwt,
      refreshTokens,
    });

    await expectCode(
      service.refresh('old-refresh-token'),
      ErrorCode.AUTH_REFRESH_INVALID,
    );
    expect(refreshTokens.exists).toHaveBeenCalledWith({
      familyId: 'family-1',
      familyRevokedAt: { $ne: null },
    });
    expect(refreshTokens.updateOne).toHaveBeenCalledWith(
      { tokenHash: sha256('new-refresh-token'), revokedAt: null },
      { $set: { revokedAt: expect.any(Date) as Date } },
    );
  });
});
