import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@thesis/shared';
import request, { Response } from 'supertest';
import {
  closeTestApp,
  createTestApp,
  createUser,
  http,
  loginAgent,
  TEST_PASSWORD,
} from './utils/test-app';

function cookiesOf(res: Response): Record<string, string> {
  const raw =
    (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return Object.fromEntries(
    raw.map((c) => {
      const [pair] = c.split(';');
      const [name, ...value] = pair.split('=');
      return [name, value.join('=')];
    }),
  );
}

function rawCookie(res: Response, name: string): string | undefined {
  const raw =
    (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return raw.find((c) => c.startsWith(`${name}=`));
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let email: string;

  beforeAll(async () => {
    app = await createTestApp();
    email = (await createUser(app, { roles: [Role.COORDINATOR] })).email;
  });
  afterAll(() => closeTestApp(app));

  const login = (body: object) =>
    request(http(app)).post('/api/auth/login').send(body);

  it('logs in and sets httpOnly access and refresh cookies', async () => {
    const res = await login({ email, password: TEST_PASSWORD }).expect(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookies = cookiesOf(res);
    expect(cookies.access_token).toBeTruthy();
    expect(cookies.refresh_token).toBeTruthy();
    const header = (res.headers['set-cookie'] as unknown as string[]).join(
      ' | ',
    );
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Path=/api/auth');
    for (const name of ['access_token', 'refresh_token']) {
      const cookie = rawCookie(res, name);
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    }
  });

  it('rejects login for a user without password hash (external juror)', async () => {
    const juror = await createUser(app, {
      roles: [Role.EXTERNAL_JUROR],
      password: undefined,
    });
    const res = await login({
      email: juror.email,
      password: TEST_PASSWORD,
    }).expect(401);
    expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('rejects a wrong password with AUTH_INVALID_CREDENTIALS', async () => {
    const res = await login({ email, password: 'wrong-password' }).expect(401);
    expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('rejects an unknown email with the same code', async () => {
    const res = await login({
      email: 'ghost@test.edu.co',
      password: TEST_PASSWORD,
    }).expect(401);
    expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('rejects an oversized password before hashing', async () => {
    const res = await login({ email, password: 'x'.repeat(257) }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('validates the login body', async () => {
    const res = await login({ email: 'nope' }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('requires a session for /me', async () => {
    const res = await request(http(app)).get('/api/auth/me').expect(401);
    expect(res.body.code).toBe('AUTH_UNAUTHENTICATED');
  });

  it('returns the current user with the cookie session', async () => {
    const agent = await loginAgent(app, email);
    const res = await agent.get('/api/auth/me').expect(200);
    expect(res.body.user.email).toBe(email);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const server = http(app);
    const first = cookiesOf(
      await login({ email, password: TEST_PASSWORD }).expect(200),
    ).refresh_token;

    const rotated = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${first}`)
      .expect(200);
    const second = cookiesOf(rotated).refresh_token;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(rotated.body.user.email).toBe(email);

    const reuse = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${first}`)
      .expect(401);
    expect(reuse.body.code).toBe('AUTH_REFRESH_INVALID');
    // reuse detection revoked the whole family, including the newest token
    await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${second}`)
      .expect(401);
  });

  it('allows exactly one of two concurrent refreshes with the same token', async () => {
    const server = http(app);
    const token = cookiesOf(
      await login({ email, password: TEST_PASSWORD }).expect(200),
    ).refresh_token;

    const results = await Promise.all(
      [0, 1].map(() =>
        request(server)
          .post('/api/auth/refresh')
          .set('Cookie', `refresh_token=${token}`),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
    const winner = results.find((r) => r.status === 200)!;
    const loser = results.find((r) => r.status === 401)!;
    expect(loser.body.code).toBe('AUTH_REFRESH_INVALID');

    // The losing call is treated as reuse: the whole family, including the winner's new token, is revoked.
    const issued = cookiesOf(winner).refresh_token;
    expect(issued).toBeTruthy();
    const replay = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${issued}`)
      .expect(401);
    expect(replay.body.code).toBe('AUTH_REFRESH_INVALID');
  });

  it('rejects refresh without cookie', async () => {
    const res = await request(http(app)).post('/api/auth/refresh').expect(401);
    expect(res.body.code).toBe('AUTH_REFRESH_INVALID');
  });

  it('logout clears the session', async () => {
    const agent = await loginAgent(app, email);
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
    await agent.post('/api/auth/refresh').expect(401);
  });

  it('logout revokes the refresh token server-side', async () => {
    const server = http(app);
    const loginRes = await login({ email, password: TEST_PASSWORD }).expect(
      200,
    );
    const token = cookiesOf(loginRes).refresh_token;
    expect(token).toBeTruthy();

    await request(server)
      .post('/api/auth/logout')
      .set('Cookie', `refresh_token=${token}`)
      .expect(204);

    // Replaying the captured cookie proves the session was revoked, not just dropped by the client.
    const replay = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${token}`)
      .expect(401);
    expect(replay.body.code).toBe('AUTH_REFRESH_INVALID');
  });

  it('logout ignores a forged refresh token', async () => {
    const server = http(app);
    const token = cookiesOf(
      await login({ email, password: TEST_PASSWORD }).expect(200),
    ).refresh_token;
    const jwt = app.get(JwtService);
    const forged = await jwt.signAsync(jwt.decode<object>(token), {
      secret: 'not-the-refresh-secret-0123456789abcdef',
    });

    await request(server)
      .post('/api/auth/logout')
      .set('Cookie', `refresh_token=${forged}`)
      .expect(204);
    // The forged cookie carried the real family id but must not have revoked it.
    await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${token}`)
      .expect(200);
  });

  it('changes the password and revokes refresh tokens', async () => {
    const user = await createUser(app, {
      roles: [Role.STUDENT],
      studentProfile: { studentCode: 'S-900' },
    });
    const agent = await loginAgent(app, user.email);

    const wrong = await agent
      .patch('/api/auth/password')
      .send({
        currentPassword: 'not-my-password',
        newPassword: 'NewPassword456!',
      })
      .expect(400);
    expect(wrong.body.code).toBe('AUTH_WRONG_PASSWORD');

    await agent
      .patch('/api/auth/password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'NewPassword456!' })
      .expect(204);
    await agent.post('/api/auth/refresh').expect(401);
    await login({ email: user.email, password: TEST_PASSWORD }).expect(401);
    await login({ email: user.email, password: 'NewPassword456!' }).expect(200);
  });
});
