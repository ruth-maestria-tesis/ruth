import { MongoMemoryServer } from 'mongodb-memory-server';

/** Starts one in-memory MongoDB for the whole e2e run. Env vars set here are inherited by test workers. */
export default async function globalSetup(): Promise<void> {
  const mongod = await MongoMemoryServer.create();
  (globalThis as Record<string, unknown>).__MONGOD__ = mongod;
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = mongod.getUri('thesis_e2e');
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef';
  process.env.CLIENT_URL = 'http://localhost:3000';
}
