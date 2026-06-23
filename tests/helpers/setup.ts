// MODULAR: test setup. Runs once before any test file.
// - Sets required env vars so modules that read them at import time don't crash.
// - Polyfills globalThis.crypto.getRandomValues for environments that lack it
//   (jsdom/happy-dom sometimes do).

// eslint-disable-next-line @typescript-eslint/no-require-imports
const env = process.env;
(env as Record<string, string | undefined>)['NODE_ENV'] = env['NODE_ENV'] || 'test';
process.env.DATABASE_URL = 'postgresql://placeholder@localhost:5432/placeholder';
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';
process.env.PINATA_JWT = process.env.PINATA_JWT || '';
process.env.LLM_API_KEY = process.env.LLM_API_KEY || '';
process.env.ARC_RPC_URL = process.env.ARC_RPC_URL || '';

if (typeof globalThis.crypto === 'undefined') {
  // vitest runs in Node 20+ where crypto is always available; this is a
  // defensive shim for older Node setups.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require('node:crypto');
  globalThis.crypto = webcrypto as unknown as Crypto;
}
