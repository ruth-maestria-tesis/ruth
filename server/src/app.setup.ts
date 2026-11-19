import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/** Global HTTP configuration shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const isDev = config.get<string>('NODE_ENV') === 'development';

  app.setGlobalPrefix('api');
  // Behind a reverse proxy (Vercel rewrite -> Render), trust X-Forwarded-For so req.ip is the
  // real client: the throttler and the audit log key on it.
  if (config.get<string>('TRUST_PROXY') === 'true') {
    (
      app.getHttpAdapter().getInstance() as {
        set: (k: string, v: unknown) => void;
      }
    ).set('trust proxy', true);
  }
  // Swagger UI needs inline scripts, so CSP is relaxed only in development (the only env that serves Swagger).
  app.use(helmet({ contentSecurityPolicy: isDev ? false : undefined }));
  app.use(cookieParser());
  app.enableCors({
    origin: config.get<string>('CLIENT_URL', 'http://localhost:3000'),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
