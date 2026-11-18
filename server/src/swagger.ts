import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ACCESS_COOKIE } from './auth/auth.constants';

export function setupSwagger(app: INestApplication): void {
  const doc = new DocumentBuilder()
    .setTitle('Thesis Repository API')
    .setDescription(
      'Universidad de Córdoba — postgraduate thesis evaluation platform',
    )
    .setVersion('0.1.0')
    .addCookieAuth(ACCESS_COOKIE)
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
}
