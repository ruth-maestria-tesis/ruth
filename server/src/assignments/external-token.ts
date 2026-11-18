import { randomBytes } from 'node:crypto';
import { sha256 } from '../common/security/hash';

/** RF-J14: random token for the link; only the hash is persisted. */
export function newExternalToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function externalAccessUrl(clientUrl: string, token: string): string {
  const url = new URL('/auth/external-access', clientUrl);
  url.searchParams.set('token', token);
  return url.toString();
}
