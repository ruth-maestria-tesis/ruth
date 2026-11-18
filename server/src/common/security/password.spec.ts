import { compare } from 'bcryptjs';
import { hashPassword, verifyPasswordOrDummy } from './password';

jest.mock('bcryptjs', () => {
  const actual = jest.requireActual<typeof import('bcryptjs')>('bcryptjs');
  return {
    ...actual,
    compare: jest.fn((plain: string, hash: string) =>
      actual.compare(plain, hash),
    ),
    hash: jest.fn((plain: string, cost: number) => actual.hash(plain, cost)),
  };
});

describe('verifyPasswordOrDummy', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct-horse');
    await expect(verifyPasswordOrDummy('correct-horse', hash)).resolves.toBe(
      true,
    );
    await expect(verifyPasswordOrDummy('wrong', hash)).resolves.toBe(false);
  });

  it('still runs bcrypt when there is no hash, and returns false', async () => {
    await expect(verifyPasswordOrDummy('anything', undefined)).resolves.toBe(
      false,
    );
    await expect(verifyPasswordOrDummy('anything', null)).resolves.toBe(false);
    expect(compare).toHaveBeenCalledTimes(2);
  });

  it('computes the dummy hash lazily and only once', async () => {
    let isolated!: {
      bcrypt: typeof import('bcryptjs');
      password: typeof import('./password');
    };
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      isolated = {
        bcrypt: require('bcryptjs') as typeof import('bcryptjs'),
        password: require('./password') as typeof import('./password'),
      };
      /* eslint-enable @typescript-eslint/no-require-imports */
    });
    const { bcrypt, password } = isolated;
    expect(bcrypt.hash).not.toHaveBeenCalled();
    await Promise.all([
      password.verifyPasswordOrDummy('a', undefined),
      password.verifyPasswordOrDummy('b', undefined),
    ]);
    await password.verifyPasswordOrDummy('c', undefined);
    expect(bcrypt.hash).toHaveBeenCalledTimes(1);
    expect(bcrypt.compare).toHaveBeenCalledTimes(3);
  });
});
