import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Role } from '@thesis/shared';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';

/**
 * Usage (from the monorepo root, with server/.env providing NODE_ENV, MONGODB_URI...):
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm --filter server admin:create
 */
async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
    process.exit(1);
  }

  let app: INestApplicationContext | undefined;
  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    const users = app.get(UsersService);
    if (await users.findByEmailWithPassword(email)) {
      console.log(`User ${email} already exists`);
    } else {
      await users.create({
        email,
        password,
        firstName: 'System',
        lastName: 'Admin',
        roles: [Role.ADMIN],
      });
      console.log(`Admin ${email} created`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}

void main();
