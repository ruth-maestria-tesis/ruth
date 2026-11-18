import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const config = app.get(ConfigService);
  if (config.get<string>('NODE_ENV') === 'development') setupSwagger(app);
  await app.listen(Number(config.get('PORT', 3001)));
}

void bootstrap();
