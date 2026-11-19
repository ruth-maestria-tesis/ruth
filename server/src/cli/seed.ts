import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { normalizeSeedTag, runSeed, SeedResult } from '../seed/seed';

/**
 * Usage (from the monorepo root, with server/.env providing NODE_ENV, MONGODB_URI...):
 *   pnpm --filter server seed -- --reset [--tag=DEMO] [--force]
 * Refuses to run with NODE_ENV=production unless --force is passed.
 * Without --reset it refuses to run when the tagged data already exists.
 */
function printSummary(result: SeedResult): void {
  console.log(`\nSeed ${result.tag} listo.\n`);
  console.log('Credenciales:');
  console.table(result.credentials);
  console.log('Tesis sembradas:');
  console.table(
    result.theses.map((t) => ({
      code: t.code,
      status: t.status,
      student: t.studentEmail,
      note: t.note ?? '',
    })),
  );
  if (result.externalLink) {
    console.log(
      `Enlace externo (${result.externalLink.jurorEmail}, tesis ${result.externalLink.thesisCode}, asignación PENDIENTE):`,
    );
    console.log(`  ${result.externalLink.url}\n`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const force = args.includes('--force');
  const tagArg = args.find((a) => a.startsWith('--tag='));

  let app: INestApplicationContext | undefined;
  try {
    const tag = normalizeSeedTag(tagArg?.slice('--tag='.length));
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    const result = await runSeed(app, {
      tag,
      reset,
      force,
      log: (msg) => console.log(msg),
    });
    printSummary(result);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}

void main();
