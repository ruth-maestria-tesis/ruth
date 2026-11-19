import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

type Handler = (req: Request, res: Response) => void;

let cached: Promise<Handler> | undefined;

/** Boots Nest once per serverless instance and reuses it (and its Mongo connection) across invocations. */
async function bootstrap(): Promise<Handler> {
  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    logger: ['error', 'warn', 'log'],
  });
  configureApp(app);
  await app.init();
  return server;
}

/** Vercel Node.js function entry: `api/index.js` re-exports this. */
export default async function handler(
  req: Request,
  res: Response,
): Promise<void> {
  cached ??= bootstrap().catch((err: unknown) => {
    cached = undefined; // retry the boot on the next invocation
    throw err;
  });
  const app = await cached;
  app(req, res);
}
