import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/helpers/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    pool: 'forks',
    // MODULAR: cap concurrent forks so the 17 test files don't all spin
    // up a PGlite (WASM Postgres) instance at once. Vitest's default
    // maxForks = cpus().length, which on a typical dev/CI box causes
    // agents / feed / publish to time out at beforeAll awaiting
    // `_pg.waitReady` (~30s of CPU thrash). Capping to 4 keeps wall
    // time well within the 30s hook timeout while still running the
    // rest of the suite in parallel.
    poolOptions: {
      forks: {
        maxForks: 4,
      },
    },
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
