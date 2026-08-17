#!/usr/bin/env tsx
// MODULAR: Bulk-ingest your own audio files through the REAL artist
// pipeline: submit → pay fee (real USDC on Arc) → 3 agent reviews →
// publish. Published tracks land as catalogSource 'live' — licensable
// and settleable, unlike the guided-demo ccMixter catalog.
//
// Usage:
//   npx tsx scripts/ingest-my-tracks.ts --dir ~/Music/tracks
//   npx tsx scripts/ingest-my-tracks.ts --manifest tracks.json
//   npx tsx scripts/ingest-my-tracks.ts song1.mp3 song2.wav
//
// Manifest format (optional; anything not listed falls back to filename
// title + default artist/type):
//   {
//     "artistName": "Your Name",
//     "tracks": [
//       { "file": "songs/a.mp3", "title": "A", "versionType": "studio",
//         "genre": "indie", "mood": "warm", "description": "..." }
//     ]
//   }
//
// Env:
//   VERSIONS_BASE_URL   default https://versions.persidian.com
//   INGEST_ARTIST_PK    artist wallet key; if unset, a key is generated
//                       and persisted to .demo/artist-wallet.json (gitignored)
//   INGEST_ARTIST_NAME  default artist name (manifest wins)
//
// Live mode funds each submission via the demo faucet
// (POST /api/v1/demo/faucet — 1.00 USDC from the platform treasury),
// then the artist wallet pays the 0.50 USDC fee on-chain and the script
// verifies payment with the real tx hash. Mock mode uses a synthetic hash.

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, defineChain, http, type Chain } from 'viem';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { encodeErc20Transfer } from '../src/lib/erc20-transfer';

const BASE = process.env.VERSIONS_BASE_URL ?? 'https://versions.persidian.com';
const SUBMISSION_MESSAGE = 'VERSIONS_LEPTON_SUBMIT';
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac']);
const CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
};
const DEMO_DIR = path.join(process.cwd(), '.demo');
const ARTIST_KEY_FILE = path.join(DEMO_DIR, 'artist-wallet.json');
const POLL_TIMEOUT_MS = 300_000; // live LLM reviews take a while
const POLL_INTERVAL_MS = 2_000;

function header(label: string) {
  console.log(`\n\x1b[1m\x1b[36m▶ ${label}\x1b[0m`);
}
function ok(msg: string) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}
function info(msg: string) {
  console.log(`  \x1b[2m${msg}\x1b[0m`);
}
function err(msg: string) {
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
}

interface TrackSpec {
  file: string;
  title?: string;
  versionType?: string;
  genre?: string;
  mood?: string;
  description?: string;
}

function parseArgs(argv: string[]): { dir?: string; manifest?: string; files: string[] } {
  const files: string[] = [];
  let dir: string | undefined;
  let manifest: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') dir = argv[++i];
    else if (a === '--manifest') manifest = argv[++i];
    else if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    else files.push(a);
  }
  return { dir, manifest, files };
}

function collectFromDir(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFromDir(full));
    else if (AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function loadManifest(p: string): { artistName?: string; tracks: TrackSpec[] } {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as {
    artistName?: string;
    tracks?: TrackSpec[];
  };
  if (!Array.isArray(raw.tracks)) throw new Error('manifest must have a "tracks" array');
  return { artistName: raw.artistName, tracks: raw.tracks };
}

function buildMultipart(
  fields: Array<[string, string]>,
  file: { name: string; buffer: Buffer; contentType: string },
): { body: Buffer; boundary: string } {
  const boundary = `----vers-ingest-${Date.now()}-${crypto.randomInt(1e6)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of fields) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${file.name}"\r\nContent-Type: ${file.contentType}\r\n\r\n`),
  );
  parts.push(file.buffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), boundary };
}

async function api<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: { data?: T; error?: { code?: string; message?: string } } | null = null;
  try {
    json = text ? (JSON.parse(text) as typeof json) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${json?.error?.code ?? ''} ${json?.error?.message ?? text}`.trim());
  }
  return (json?.data ?? (json as unknown as T)) as T;
}

async function main() {
  const argv = process.argv.slice(2);
  const { dir, manifest, files: argFiles } = parseArgs(argv);
  if (!dir && !manifest && argFiles.length === 0) {
    console.log('Usage: npx tsx scripts/ingest-my-tracks.ts --dir <folder> | --manifest tracks.json | file1.mp3 ...');
    process.exit(1);
  }

  console.log('\n\x1b[1m\x1b[33m🎵 VERSIONS track ingest (real pipeline)\x1b[0m\n');
  console.log(`  base = ${BASE}`);

  // ── artist wallet ──
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  let pk = process.env.INGEST_ARTIST_PK?.trim();
  if (!pk && fs.existsSync(ARTIST_KEY_FILE)) {
    pk = (JSON.parse(fs.readFileSync(ARTIST_KEY_FILE, 'utf8')) as { privateKey?: string }).privateKey;
    if (pk) ok('reusing artist wallet from .demo/artist-wallet.json');
  }
  if (!pk) {
    pk = generatePrivateKey();
    fs.writeFileSync(ARTIST_KEY_FILE, JSON.stringify({ privateKey: pk }, null, 2), { mode: 0o600 });
    ok('generated artist wallet → .demo/artist-wallet.json (live mode funds it via the demo faucet)');
  }
  const artist = privateKeyToAccount(pk as `0x${string}`);
  ok(`artist wallet: ${artist.address}`);
  const artistName = process.env.INGEST_ARTIST_NAME ?? 'Versions Artist';

  // ── gather track specs ──
  let manifestData: { artistName?: string; tracks: TrackSpec[] } | null = null;
  if (manifest) manifestData = loadManifest(manifest);
  const manifestName = manifestData?.artistName ?? artistName;
  const specs: TrackSpec[] = [];
  const pushFile = (f: string) => {
    const m = manifestData?.tracks.find((t) => path.resolve(t.file) === path.resolve(f));
    specs.push(m ?? { file: f });
  };
  if (manifestData) for (const t of manifestData.tracks) specs.push(t);
  else if (dir) collectFromDir(dir).forEach(pushFile);
  else argFiles.forEach(pushFile);
  if (specs.length === 0) {
    err('no audio files found');
    process.exit(1);
  }
  ok(`${specs.length} track(s) to ingest`);

  // ── arc info (live vs mock) ──
  const arcInfo = await api<{
    mock: boolean;
    chainId: string;
    rpcUrl: string | null;
    usdcContract: string | null;
    usdcDecimals?: number;
    platformWallet: string | null;
  }>(`${BASE}/api/v1/arc/info`);
  const isLive = arcInfo.mock === false;
  ok(isLive ? `Arc LIVE (chain ${arcInfo.chainId})` : 'Arc mock mode (synthetic tx hashes)');

  let liveClients: {
    wallet: ReturnType<typeof createWalletClient>;
    public: ReturnType<typeof createPublicClient>;
  } | null = null;
  if (isLive) {
    const chain: Chain = defineChain({
      id: Number(BigInt(arcInfo.chainId)),
      name: 'Arc',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
      rpcUrls: { default: { http: [arcInfo.rpcUrl!] }, public: { http: [arcInfo.rpcUrl!] } },
    });
    const transport = http(arcInfo.rpcUrl!);
    liveClients = {
      wallet: createWalletClient({ account: artist, chain, transport }),
      public: createPublicClient({ chain, transport }),
    };
  }

  const results: Array<{ file: string; id?: string; status: string; error?: string }> = [];

  for (const spec of specs) {
    const file = spec.file;
    header(path.basename(file));
    try {
      if (!fs.existsSync(file)) throw new Error('file not found');
      const ext = path.extname(file).toLowerCase();
      const buffer = fs.readFileSync(file);
      const metadata = {
        title: spec.title ?? path.basename(file, ext).replace(/[-_]+/g, ' ').trim(),
        artistName: manifestName,
        versionType: spec.versionType ?? 'studio',
        genre: spec.genre ?? null,
        mood: spec.mood ?? null,
        description: spec.description ?? `Ingested via scripts/ingest-my-tracks.ts from ${path.basename(file)}.`,
      };
      const signature = await artist.signMessage({ message: SUBMISSION_MESSAGE });
      const { body, boundary } = buildMultipart(
        [
          ['signature', signature],
          ['artistWallet', artist.address],
          ['metadata', JSON.stringify(metadata)],
        ],
        { name: path.basename(file), buffer, contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream' },
      );

      const sub = await api<{ id: string; status: string; fee_quote_usdc: string; deduped?: boolean }>(
        `${BASE}/api/v1/submissions`,
        {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body,
        },
      );
      ok(`submitted: ${sub.id}${sub.deduped ? ' (deduped — audio already on file)' : ''}`);
      results.push({ file, id: sub.id, status: sub.status });

      if (sub.status === 'published') {
        ok('already published — skipping payment');
        continue;
      }

      // ── pay the fee ──
      let txHash: string;
      if (!isLive) {
        txHash = `0x${crypto.createHash('sha256').update(`${sub.id}-${Date.now()}`).digest('hex')}`;
        info('mock mode: synthetic tx hash');
      } else {
        info(`fee quote: ${sub.fee_quote_usdc} USDC — funding artist wallet via faucet…`);
        await api(`${BASE}/api/v1/demo/faucet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: artist.address }),
        });
        ok('faucet funded (1.00 USDC)');
        info('paying fee on-chain…');
        const data = encodeErc20Transfer({
          to: arcInfo.platformWallet!,
          amountUsdc: sub.fee_quote_usdc,
          usdcDecimals: arcInfo.usdcDecimals ?? 6,
        });
        txHash = (await liveClients!.wallet.sendTransaction({
          account: artist,
          to: arcInfo.usdcContract! as `0x${string}`,
          data,
          value: 0n,
        })) as string;
        await liveClients!.public.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 60_000 });
        ok(`fee paid: ${txHash.slice(0, 18)}…`);
      }

      const verified = await api<{ status: string }>(`${BASE}/api/v1/submissions/${sub.id}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      });
      ok(`payment verified → ${verified.status} (agents reviewing…)`);

      // ── poll to published ──
      const start = Date.now();
      let status = verified.status;
      while (Date.now() - start < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const poll = await api<{ status: string }>(`${BASE}/api/v1/submissions/${sub.id}`).catch(() => null);
        status = poll?.status ?? status;
        info(`tick: ${status} (${Math.round((Date.now() - start) / 1000)}s)`);
        if (status === 'published') break;
      }
      if (status === 'published') ok(`published as LIVE catalog ✔ (${Math.round((Date.now() - start) / 1000)}s)`);
      else err(`not published within ${POLL_TIMEOUT_MS / 1000}s (last: ${status})`);
      const r = results.find((x) => x.id === sub.id);
      if (r) r.status = status;
      await new Promise((r) => setTimeout(r, 1000)); // rate-limit courtesy
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      err(msg);
      const r = results.find((x) => x.file === file);
      if (r) r.error = msg;
    }
  }

  // ── make the new tracks semantically searchable ──
  header('Embedding backfill');
  try {
    const backfill = await api<{ embedded: number; skipped: number; mock: boolean }>(
      `${BASE}/api/v1/embeddings/backfill`,
      { method: 'POST' },
    );
    ok(`backfill: ${backfill.embedded} embedded, ${backfill.skipped} skipped (${backfill.mock ? 'mock' : 'live'})`);
  } catch (e) {
    err(`backfill failed: ${(e as Error).message}`);
  }

  header('Summary');
  for (const r of results) {
    console.log(`  ${r.status === 'published' ? '✔' : r.error ? '✗' : '…'} ${path.basename(r.file)} → ${r.status}${r.error ? ` (${r.error})` : ''}`);
  }
  const published = results.filter((r) => r.status === 'published').length;
  console.log(`\n  ${published}/${results.length} published as live, licensable tracks.`);
  if (published > 0) {
    console.log('  They are now searchable by brief and can be licensed + settled on Arc.\n');
  }
}

main().catch((e) => {
  console.error(`\ningest failed: ${(e as Error).message}\n`);
  process.exit(1);
});
