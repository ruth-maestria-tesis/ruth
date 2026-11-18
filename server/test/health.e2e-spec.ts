import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { closeTestApp, createTestApp, http } from './utils/test-app';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => closeTestApp(app));

  it('GET /api/health is public', async () => {
    const res = await request(http(app)).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('unknown routes return the uniform error body', async () => {
    const res = await request(http(app)).get('/api/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('malformed JSON bodies return the uniform error body', async () => {
    const res = await request(http(app))
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{bad json')
      .expect(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
    });
  });
});
