// MODULAR: Postgres connection. Uses a real `pg` Pool (node-postgres)
// behind drizzle — the app is a long-lived Node process (Docker on a
// single VM, `output: standalone`), not a serverless runtime, so a
// classic connection pool is the right tool:
//
// PERFORMANT: pooled persistent connections (no per-query TLS/HTTP
// round-trip the way the old neon HTTP driver paid), no 1000-row result
// cap, and — critically — REAL multi-statement transactions. The cases
// service opens genuine `db.transaction()` blocks, which the HTTP driver
// could not execute.
//
// Ops: keep `max` modest — Neon's compute can only host so many
// concurrent connections; the pool serializes overflow in-process.
// Point DATABASE_URL at the pooler endpoint (…:6432) and the pool will
// fan out across it further.
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

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

// Lazily construct the pool only when a connection string exists. The Pool
// connects on first query, never at construction — so module import is
// side-effect free (build phase, tests that vi.mock this module).
const pool = connectionString
  ? new Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : undefined;

export const db = pool
  ? drizzle({ client: pool })
  : (undefined as unknown as ReturnType<typeof drizzle>);

export type Db = typeof db;
