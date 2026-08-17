// MODULAR: config schema tests. Verifies that empty-string env values from
// docker compose env_file (`KEY=`) are treated as absent — an empty optional
// URL must not fail `z.string().url().optional()` at module load (the bug
// that 500'd /api/cron/sweep on deploy when the server .env carried a
// placeholder `LLM_API_URL=`).

import { describe, it, expect, vi, afterEach } from 'vitest';

const REQUIRED = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/versions',
  NEXTAUTH_SECRET: 'a'.repeat(40),
};

// Save/restore the keys the tests manage so other test files keep their env.
const MANAGED = [...Object.keys(REQUIRED), 'LLM_API_URL', 'ARC_RPC_URL', 'NEXTAUTH_URL', 'NEXT_PHASE'];

afterEach(() => {
  for (const k of MANAGED) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.resetModules();
});

let savedEnv: Record<string, string | undefined> = {};

async function loadEnv(overrides: Record<string, string | undefined>) {
  savedEnv = {};
  for (const k of MANAGED) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import('../../src/lib/config');
  return mod.env;
}

describe('config: empty-string env values', () => {
  it('treats an empty optional URL as absent (no throw)', async () => {
    const env = await loadEnv({ ...REQUIRED, LLM_API_URL: '', ARC_RPC_URL: '' });
    expect(env.LLM_API_URL).toBeUndefined();
    expect(env.ARC_RPC_URL).toBeUndefined();
  });

  it('parses valid optional URLs normally', async () => {
    const env = await loadEnv({
      ...REQUIRED,
      LLM_API_URL: 'https://openrouter.ai/api/v1',
      ARC_RPC_URL: 'https://rpc.testnet.arc.network',
    });
    expect(env.LLM_API_URL).toBe('https://openrouter.ai/api/v1');
    expect(env.ARC_RPC_URL).toBe('https://rpc.testnet.arc.network');
  });

  it('still rejects a malformed non-empty URL', async () => {
    await expect(loadEnv({ ...REQUIRED, LLM_API_URL: 'not-a-url' })).rejects.toThrow();
  });

  it('still fails fast when a required var is missing', async () => {
    const withoutDb: Record<string, string> = { ...REQUIRED };
    delete withoutDb.DATABASE_URL;
    await expect(loadEnv(withoutDb)).rejects.toThrow();
  });
});
