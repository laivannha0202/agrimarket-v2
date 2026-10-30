import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * `migrate diff --from-migrations` needs a disposable shadow schema. It is
 * only read from the environment so normal `migrate deploy`/`migrate dev`
 * runs are unaffected; C-19 sets it to an isolated `*_shadow_test` schema.
 */
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL?.trim();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
