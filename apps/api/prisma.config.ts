import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Optional so `prisma generate` (typecheck/build) works without a database, e.g. in CI.
    // migrate/seed commands still fail clearly if DATABASE_URL is missing.
    url: process.env.DATABASE_URL ?? '',
  },
});
