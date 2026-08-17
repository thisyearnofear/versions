#!/usr/bin/env tsx
// MODULAR: Pre-authenticate a supervisor wallet session (NextAuth
// credentials) without a browser. Signs the exact WALLET_SIGN_IN_MESSAGE
// with a wallet key and walks the NextAuth v5 callback by hand, then saves
// the session cookie to .demo/cookies.txt for reuse:
//
//   curl -H "Cookie: $(cat .demo/cookies.txt)" https://versions.persidian.com/api/v1/licenses ...
//
// The wallet key is generated once and kept in .demo/wallet.json (gitignored).
// It is only an IDENTITY for the demo — the supervisor never pays anything;
// license settlement is funded by the platform treasury. Safe to reuse.
//
// Usage:
//   VERSIONS_BASE_URL=https://versions.persidian.com npx tsx scripts/demo-signin.ts
//   DEMO_SIGNIN_PK=0x... npx tsx scripts/demo-signin.ts   # bring your own key

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';
import path from 'path';

const BASE = process.env.VERSIONS_BASE_URL ?? 'https://versions.persidian.com';

// Must match WALLET_SIGN_IN_MESSAGE in src/lib/use-credentials-sign-in.ts
// exactly (duplicated here so this script never imports React/next-auth
// client code into Node).
const WALLET_SIGN_IN_MESSAGE =
  'Sign in to VERSIONS marketplace\n\nThis signature verifies your wallet ownership and creates a session. No transaction is initiated.\n\nBy signing, you agree to the VERSIONS terms of service.';

const DEMO_DIR = path.join(process.cwd(), '.demo');
const KEY_FILE = path.join(DEMO_DIR, 'wallet.json');
const COOKIE_FILE = path.join(DEMO_DIR, 'cookies.txt');

function ok(msg: string) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}
function err(msg: string) {
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
}

function collectCookies(res: Response): string[] {
  const out: string[] = [];
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of all) {
    const pair = c.split(';')[0];
    if (pair && pair.includes('=')) out.push(pair.trim());
  }
  return out;
}

async function main() {
  console.log('\n\x1b[1m\x1b[33m🔑 VERSIONS demo sign-in\x1b[0m\n');
  console.log(`  base = ${BASE}\n`);

  fs.mkdirSync(DEMO_DIR, { recursive: true });

  // 1. Wallet: env key wins, else reuse .demo/wallet.json, else generate.
  let pk = process.env.DEMO_SIGNIN_PK?.trim();
  let saved: { address?: string; privateKey?: string } = {};
  if (!pk && fs.existsSync(KEY_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
      pk = saved.privateKey;
      if (pk) ok(`reusing wallet from .demo/wallet.json`);
    } catch {
      saved = {};
    }
  }
  if (!pk) {
    pk = generatePrivateKey();
    ok('generated a fresh demo wallet (saved to .demo/wallet.json — keep it out of git)');
  }
  const account = privateKeyToAccount(pk as `0x${string}`);
  fs.writeFileSync(
    KEY_FILE,
    JSON.stringify({ address: account.address, privateKey: pk }, null, 2),
    { mode: 0o600 },
  );
  ok(`wallet: ${account.address}`);

  // 2. CSRF token.
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  if (!csrfRes.ok) {
    err(`csrf fetch failed (${csrfRes.status})`);
    process.exit(1);
  }
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const jar = collectCookies(csrfRes);
  ok(`csrf token received`);

  // 3. EIP-191 signature + credentials callback.
  const signature = await account.signMessage({ message: WALLET_SIGN_IN_MESSAGE });
  const form = new URLSearchParams({
    csrfToken,
    address: account.address,
    signature,
    message: WALLET_SIGN_IN_MESSAGE,
    callbackUrl: `${BASE}/supervisor`,
    json: 'true',
  });
  const cbRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: jar.join('; '),
    },
    body: form,
    redirect: 'manual',
  });
  const cbCookies = collectCookies(cbRes);
  jar.push(...cbCookies);
  const sessionCookie = cbCookies.find((c) => c.includes('session-token'));
  if (!sessionCookie) {
    err(`no session cookie in callback response (${cbRes.status})`);
    console.log(`  body: ${(await cbRes.text()).slice(0, 200)}`);
    process.exit(1);
  }

  // 4. Verify the session.
  const sessRes = await fetch(`${BASE}/api/auth/session`, {
    headers: { Cookie: jar.join('; ') },
  });
  const session = (await sessRes.json()) as { user?: { walletAddress?: string; name?: string } } | null;
  if (!session?.user) {
    err('session endpoint returned no user — sign-in failed');
    process.exit(1);
  }
  ok(`authenticated as ${session.user.walletAddress ?? session.user.name}`);

  // 5. Persist the cookie header for curl / other scripts.
  fs.writeFileSync(COOKIE_FILE, jar.join('; ') + '\n', { mode: 0o600 });
  ok(`session cookie saved → ${path.relative(process.cwd(), COOKIE_FILE)}`);

  console.log('\n  Use it like:');
  console.log(`    curl -H "Cookie: $(cat .demo/cookies.txt)" \\`);
  console.log(`      ${BASE}/api/v1/licenses`);
  console.log('\n  Or paste the cookie into your browser devtools (Application → Cookies');
  console.log('  → versions.persidian.com) to browse /supervisor pre-authenticated.\n');
}

main().catch((e) => {
  err(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
