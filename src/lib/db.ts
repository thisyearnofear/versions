import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// `next build` imports the service/route module graph (e.g. to collect page
// data for /api/feed) and executes top-level code. Docker builds have no
// DATABASE_URL on disk (.dockerignore excludes .env; baking DB creds into
// image layers would leak them via `docker history`). Next sets
// NEXT_PHASE=PHASE_PRODUCTION_BUILD during `next build`.
export const isNextBuild = process.env.NEXT_PHASE === 'phase-production-build';

const connectionString = process.env.DATABASE_URL;
if (!connectionString && !isNextBuild) {
  throw new Error('DATABASE_URL is required at runtime');
}

// Lazily construct the pool only when a connection string exists. During the
// build phase `db` stays undefined (nothing calls it at import time); at
// runtime the env-var schema in src/lib/config.ts already fails fast if the
// connection string is missing.
export const db = connectionString
  ? drizzle(neon(connectionString), { schema })
  : (undefined as unknown as ReturnType<typeof drizzle>);

export type Db = typeof db;
