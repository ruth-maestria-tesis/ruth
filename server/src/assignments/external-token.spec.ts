import { sha256 } from '../common/security/hash';
import { externalAccessUrl, newExternalToken } from './external-token';

describe('external token (RF-J14)', () => {
  it('creates a 32-byte base64url token and returns only its hash for storage', () => {
    const { token, hash } = newExternalToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(sha256(token));
    expect(newExternalToken().token).not.toBe(token);
  });

  it('builds the client link', () => {
    expect(externalAccessUrl('http://localhost:3000', 'abc_-1')).toBe(
      'http://localhost:3000/auth/external-access?token=abc_-1',
    );
  });
});
