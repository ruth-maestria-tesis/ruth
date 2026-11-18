import { compare, hash } from 'bcryptjs';

const COST = process.env.NODE_ENV === 'test' ? 4 : 12;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, COST);
}

export function verifyPassword(
  plain: string,
  passwordHash: string,
): Promise<boolean> {
  return compare(plain, passwordHash);
}

let dummyHash: Promise<string> | undefined;

/**
 * Like verifyPassword, but when there is no hash (unknown user, or an external juror
 * without password) it still runs bcrypt against a dummy hash of the same cost and
 * returns false. This keeps the response time independent of whether the account exists.
 * The dummy hash is computed lazily once and the promise is cached.
 */
export async function verifyPasswordOrDummy(
  plain: string,
  passwordHash: string | null | undefined,
): Promise<boolean> {
  if (passwordHash) return compare(plain, passwordHash);
  dummyHash ??= hashPassword('dummy-password-for-constant-time-login');
  await compare(plain, await dummyHash);
  return false;
}
