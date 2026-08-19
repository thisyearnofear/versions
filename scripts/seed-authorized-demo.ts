#!/usr/bin/env tsx
// MODULAR: Seed an artist-authorized version program with synthetic demo
// tracks into prod — the one thing standing between "cool features" and a
// visible authorized-version demo.
//
// Creates:
//   1. A version_programs row (consent policy, royalty splits)
//   2. Two submissions linked to the program (original + derivative sibling)
//      with family_id for grouping, lineage, and authorization_status
//   3. Runs the full ingest pipeline: submit → faucet → pay → agent review
//      → publish → audio feature extraction
//
// The result: 2 authorized versions visible in DiscoverView with:
//   - ConsentLineagePanel rendering (program, splits, lineage, audio features)
//   - Version family grouping (expandable sibling panel)
//   - Agent scores from actual audio features (chromagram extraction)
//
// Usage:
//   npx tsx scripts/seed-authorized-demo.ts
//
// Env:
//   ELEVENLABS_API_KEY — required for generating demo audio
//   VERSIONS_BASE_URL  — default https://versions.persidian.com
//   INGEST_ARTIST_PK   — artist wallet key; if unset, auto-generated
//   INGEST_ARTIST_NAME — default "Demo Artist"

// Load .env FIRST — tsx doesn't auto-load it, and db.ts throws if DATABASE_URL is missing
import { config } from 'dotenv';
config({ path: ['.env', '.env.local'] });

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, type Address } from 'viem';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { submissions, publishedVersions, versionPrograms, agentReviews } from '../src/lib/schema';
import { extractAudioFeatures } from '../src/lib/audio-features';

// ── Constants ──────────────────────────────────────────────────

const BASE = process.env.VERSIONS_BASE_URL ?? 'https://versions.persidian.com';
const DEMO_DIR = path.join(process.cwd(), '.demo');
const ARTIST_KEY_FILE = path.join(DEMO_DIR, 'artist-wallet.json');
const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');
const OUT_DIR = path.join(DEMO_DIR, 'tracks');
const POLL_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 3_000;

// ── Program definition ─────────────────────────────────────────

const PROGRAM_ID = 'pilot-demo-0001';
const RIGHTS_HOLDER = '0x0000000000000000000000000000000000000001';
const SOURCE_TITLE = 'Midnight Chromatics';
const SOURCE_ARTIST = 'Elena Voss';

const CONSENT_POLICY = JSON.stringify({
  allowed_transformations: ['alt_vocals', 'remix', 'mood_flip', 'tempo_shift'],
  prohibited: ['use_in_advertising', 'defamatory_context'],
  territories: ['worldwide'],
  term_months: 12,
  revocable: true,
  model_training_allowed: false,
  notes: 'Demo consent policy for Arc Demos & Meetup — synthetic rights holder.',
  agreement_ref: 'docs/pilot-agreement-draft.md',
});

const SPLITS = JSON.stringify([
  { wallet: RIGHTS_HOLDER, label: 'rights_holder', share_bps: 4000 },
  { wallet: '0x0000000000000000000000000000000000000002', label: 'creator', share_bps: 3000 },
  { wallet: '0x0000000000000000000000000000000000000003', label: 'publisher', share_bps: 2000 },
  { wallet: '0x0000000000000000000000000000000000000004', label: 'platform', share_bps: 1000 },
]);

// ── Helpers ─────────────────────────────────────────────────────

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

// ── ElevenLabs audio generation ────────────────────────────────

async function generateAudio(title: string, prompt: string): Promise<string | null> {
  if (!process.env.ELEVENLABS_API_KEY) {
    err(`ELEVENLABS_API_KEY not set for generating ${title}`);
    return null;
  }

  info(`${title} — generating via ElevenLabs Music API...`);

  try {
    const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
    const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

    const filename = `authorized-demo-${title.replace(/\s+/g, '-').toLowerCase()}.mp3`;
    const outputPath = path.join(UPLOAD_DIR, filename);

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
      ok(`${title} — already exists (${(fs.statSync(outputPath).size / 1024).toFixed(0)} KB)`);
      return filename;
    }

    const audio = await client.music.compose({
      prompt,
      musicLengthMs: 30000,
    });

    const chunks: Buffer[] = [];
    for await (const chunk of audio) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    ok(`${title} — saved (${(buffer.length / 1024).toFixed(0)} KB)`);
    return filename;
  } catch (err) {
    err(`${title} — failed: ${(err as Error).message}`);
    return null;
  }
}

// ── Ingest helpers ──────────────────────────────────────────────

async function getArtistWallet(): Promise<{ privateKey: string; address: string }> {
  let privateKey = '';

  if (fs.existsSync(ARTIST_KEY_FILE)) {
    privateKey = JSON.parse(fs.readFileSync(ARTIST_KEY_FILE, 'utf8')).privateKey;
  } else if (process.env.INGEST_ARTIST_PK) {
    privateKey = process.env.INGEST_ARTIST_PK;
  } else {
    privateKey = generatePrivateKey();
    fs.mkdirSync(DEMO_DIR, { recursive: true });
    const addr = privateKeyToAccount(privateKey as `0x${string}`).address;
    fs.writeFileSync(ARTIST_KEY_FILE, JSON.stringify({ privateKey, address: addr }));
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return { privateKey: account.privateKey, address: account.address };
}

async function faucet(address: string): Promise<void> {
  try {
    const res = await fetch(`${BASE}/api/v1/demo/faucet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (res.ok) ok(`faucet funded ${address}`);
    else info(`faucet ${res.status}`);
  } catch {
    info('faucet unavailable');
  }
}

async function submitTrack(
  artistWallet: string,
  title: string,
  versionType: string,
  filename: string,
  genre: string,
  mood: string,
  description: string,
): Promise<string | null> {
  const audioPath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(audioPath)) {
    err(`Audio not found: ${audioPath}`);
    return null;
  }

  const buffer = fs.readFileSync(audioPath);
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

  const res = await fetch(`${BASE}/api/v1/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      artistWallet,
      title,
      versionType,
      genre,
      artistMood: mood,
      description,
      contentType: 'audio/mpeg',
      audioSizeBytes: buffer.length,
      audioSha256: checksum,
      feeQuoteUsdc: '0.50',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    err(`submit ${title}: ${res.status} ${text}`);
    return null;
  }

  const data = await res.json();
  const submissionId = data.data?.id ?? data.submissionId;
  ok(`submitted ${title} (id: ${submissionId})`);
  return submissionId;
}

async function pollReviews(submissionId: string): Promise<void> {
  info(`Polling agent reviews for ${submissionId}...`);
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    try {
      const res = await fetch(`${BASE}/api/v1/agents/${submissionId}`);
      if (res.ok) {
        const data = await res.json();
        const reviews = data.data?.reviews ?? [];
        const done = reviews.filter((r: any) => r.score !== null).length;
        if (done >= 3) { ok(`all 3 reviews complete for ${submissionId}`); return; }
        info(`  ${done}/3 reviews...`);
      }
    } catch { /* ignore */ }
    await sleep(POLL_INTERVAL_MS);
  }
  err(`timed out for ${submissionId}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  header('Authorized Version Demo Seed');

  // Step 1: Create version program via SQL (avoids drizzle typing issues)
  info('Creating version program...');
  try {
    await db.execute(sql`
      INSERT INTO version_programs (id, rights_holder_wallet, source_title, source_artist,
        consent_policy, splits, status)
      VALUES (${PROGRAM_ID}, ${RIGHTS_HOLDER}, ${SOURCE_TITLE}, ${SOURCE_ARTIST},
        ${CONSENT_POLICY}::jsonb, ${SPLITS}::jsonb, 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    ok('program created');
  } catch (err) {
    info(`error: ${(err as Error).message} — continuing (may exist)`);
  }

  // Step 2: Generate audio
  header('Generating audio');
  const prompts = [
    { title: 'Midnight Chromatics (Original)', prompt: 'Dark ambient electronic, deep pulsing bass, shimmering synth pads, cinematic and mysterious, no vocals, 90 bpm, late-night mood' },
    { title: 'Midnight Chromatics (Alt Take)', prompt: 'Dark ambient electronic, deeper bass, slower tempo, more reverb, melancholic and spacious, no vocals, 75 bpm, introspective mood' },
  ];
  const files: string[] = [];
  for (const p of prompts) {
    const f = await generateAudio(p.title, p.prompt);
    if (f) files.push(f);
  }
  if (files.length < 2) {
    err('Need 2 audio files. Exiting.');
    return;
  }

  // Step 3: Artist wallet + fund
  header('Artist wallet');
  const { address: artistWallet } = await getArtistWallet();
  ok(`wallet: ${artistWallet}`);
  await faucet(artistWallet);

  // Step 4: Submit tracks
  header('Submitting tracks');
  const trackSpecs = [
    {
      title: prompts[0].title,
      versionType: 'studio',
      genre: 'ambient electronic',
      mood: 'dark cinematic',
      description: 'Original studio take — deep ambient electronic',
      lineage: null,
    },
    {
      title: prompts[1].title,
      versionType: 'alt_take',
      genre: 'ambient electronic',
      mood: 'melancholic spacious',
      description: 'Alt take — slower, deeper, more reverb',
      lineage: JSON.stringify({
        creator_tools: ['elevenlabs-music'],
        source_version_ids: ['original-midnight-chromatics'],
        notes: 'Alt take from same source program, different tempo and mood',
      }),
    },
  ];

  const submissionIds: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const spec = trackSpecs[i];
    const id = await submitTrack(artistWallet, spec.title, spec.versionType, files[i], spec.genre, spec.mood, spec.description);
    if (id) submissionIds.push(id);
  }

  if (submissionIds.length < 2) {
    err('Need 2 submissions. Exiting.');
    return;
  }

  // Step 5: Link to program + set lineage
  header('Linking to authorized program');
  for (let i = 0; i < submissionIds.length; i++) {
    const spec = trackSpecs[i];
    await db
      .update(submissions)
      .set({
        programId: PROGRAM_ID,
        authorizationStatus: 'approved',
        authorizedAt: new Date(),
        lineage: spec.lineage ? JSON.parse(spec.lineage) : null,
      })
      .where(eq(submissions.id, submissionIds[i]));
    ok(`linked ${submissionIds[i].slice(0, 8)} to program`);
  }

  // Step 6: Poll reviews for all
  header('Agent reviews');
  for (const id of submissionIds) {
    await pollReviews(id);
  }

  // Step 7: Publish
  header('Publishing');
  for (const id of submissionIds) {
    try {
      await fetch(`${BASE}/api/v1/submissions/${id}/publish`, { method: 'POST' });
      ok(`published ${id.slice(0, 8)}`);
    } catch { /* already published or failed gracefully */ }
  }

  // Step 8: Extract audio features
  header('Audio features (chromagram)');
  for (let i = 0; i < submissionIds.length; i++) {
    const [sub] = await db
      .select({ audioPath: submissions.audioPath })
      .from(submissions)
      .where(eq(submissions.id, submissionIds[i]));

    if (sub?.audioPath) {
      const audioPath = path.join(UPLOAD_DIR, sub.audioPath);
      if (fs.existsSync(audioPath)) {
        info(`extracting features from ${sub.audioPath}...`);
        try {
          const features = await extractAudioFeatures(audioPath);
          await db
            .update(submissions)
            .set({ audioFeatures: features })
            .where(eq(submissions.id, submissionIds[i]));

          const parts: string[] = [];
          if (features.tempo) parts.push(`${features.tempo} BPM`);
          if (features.key) parts.push(features.key);
          if (features.energy !== null) parts.push(`E${features.energy.toFixed(1)}`);
          if (features.loudness !== null) parts.push(`${features.loudness} dB`);

          if (parts.length > 0) ok(`${sub.audioPath}: ${parts.join(', ')}`);
          else info('no extractable features');
        } catch (err) {
          err(`chromagram failed: ${(err as Error).message}`);
        }
      }
    }
  }

  // Step 9: Set family_id on published versions
  header('Setting up version families');
  await db
    .update(publishedVersions)
    .set({ familyId: 'midnight-chromatics-family' })
    .where(sql`${publishedVersions.submissionId} = ANY(${submissionIds})`);
  ok(`set family_id on ${submissionIds.length} versions`);

  header('✅ Done!');
  console.log(`
  \x1b[1mGo to https://versions.persidian.com/discover and search:\x1b[0m
    "dark ambient cinematic electronic"
  
  You should see:
    - \x1b[32mConsentLineagePanel\x1b[0m with program, splits, lineage, agent scores
    - \x1b[36mVersion family grouping\x1b[0m (expandable siblings panel)
    - \x1b[33mAudio features\x1b[0m extracted via chromagram
  
  \x1b[33mNote: This is synthetic demo data with fake wallet addresses.\x1b[0m
`);
}

main().catch((err) => {
  err(`Fatal: ${err}`);
  process.exit(1);
});