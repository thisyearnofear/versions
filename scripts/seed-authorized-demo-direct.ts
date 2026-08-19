#!/usr/bin/env tsx
// MODULAR: Seed an artist-authorized version program directly into the
// production DB via SQL. This creates:
//
// 1. A version_programs row (consent policy, royalty splits)
// 2. Two submissions linked to the program (original + derivative sibling)
//    with family_id for grouping, lineage, and authorization_status
// 3. Published versions with family_id, audio features, agent reviews
//
// This is a DB-side seed — it bypasses the API entirely. Use only for
// demo/sandbox data with fake wallet addresses.
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/seed-authorized-demo-direct.ts
//
// Env:
//   DATABASE_URL — Neon Postgres connection string
//   ELEVENLABS_API_KEY — optional, for generating demo audio via API

import { eq, sql } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { extractAudioFeatures } from '../src/lib/audio-features';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ path: ['.env', '.env.local'] });

// ── Constants ──────────────────────────────────────────────────

const PROGRAM_ID = 'pilot-demo-0001';
const RIGHTS_HOLDER = '0x0000000000000000000000000000000000000001';
const CREATOR = '0x0000000000000000000000000000000000000002';
const PUBLISHER = '0x0000000000000000000000000000000000000003';
const PLATFORM = '0x0000000000000000000000000000000000000004';
const PLATFORM_WALLET = '0x0000000000000000000000000000000000000005';
const ARTIST_WALLET = '0x0000000000000000000000000000000000000099'; // fake demo artist
const SOURCE_TITLE = 'Midnight Chromatics';
const SOURCE_ARTIST = 'Elena Voss';
const FAMILY_ID = 'midnight-chromatics-family';
const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 300_000;

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  header('Authorized Version Direct DB Seed');

  // Step 1: Create version program
  info('Creating version program...');
  try {
    await db.execute(sql`
      INSERT INTO version_programs (id, rights_holder_wallet, source_title, source_artist,
        consent_policy, splits, status)
      VALUES (
        ${PROGRAM_ID},
        ${RIGHTS_HOLDER},
        ${SOURCE_TITLE},
        ${SOURCE_ARTIST},
        '{"allowed_transformations":["alt_vocals","remix","mood_flip","tempo_shift"],"prohibited":["use_in_advertising","defamatory_context"],"territories":["worldwide"],"term_months":12,"revocable":true,"model_training_allowed":false,"notes":"Demo consent policy for Arc Demos & Meetup — synthetic rights holder.","agreement_ref":"docs/pilot-agreement-draft.md"}'::jsonb,
        '{"share_bps":4000,"label":"rights_holder","wallet":"0x0000000000000000000000000000000000000001"},
        '{"share_bps":3000,"label":"creator","wallet":"0x0000000000000000000000000000000000000002"},
        '{"share_bps":2000,"label":"publisher","wallet":"0x0000000000000000000000000000000000000003"},
        '{"share_bps":1000,"label":"platform","wallet":"0x0000000000000000000000000000000000000004"}'::jsonb,
        'active'
      )
      ON CONFLICT (id) DO UPDATE SET status = 'active', consent_policy = COALESCE(EXCLUDED.consent_policy, version_programs.consent_policy), splits = COALESCE(EXCLUDED.splits, version_programs.splits)
    `);
    ok('program created');
  } catch (err) {
    info(`error: ${(err as Error).message} — continuing (may exist)`);
  }

  // Step 2: Create submissions
  header('Creating submissions');
  const submissionIds: string[] = [];

  for (let i = 0; i < 2; i++) {
    const id = `sub-authorized-${i.toString().padStart(4, '0')}`;
    const title = i === 0 ? 'Midnight Chromatics (Original)' : 'Midnight Chromatics (Alt Take)';
    const versionType = i === 0 ? 'studio' : 'alt_take';
    const lineage = i === 0
      ? null
      : '{"creator_tools":["elevenlabs-music"],"source_version_ids":["original-midnight-chromatics"],"notes":"Alt take from same source program, different tempo and mood"}';

    await db.execute(sql`
      INSERT INTO submissions (id, artist_wallet, title, artist_name, version_type,
        genre, artist_mood, description, audio_path, audio_size_bytes, content_type,
        fee_quote_usdc, program_id, authorization_status, authorized_at, lineage,
        status, rating_count, submitted_at)
      VALUES (
        ${id}, ${ARTIST_WALLET}, ${title}, ${SOURCE_ARTIST}, ${versionType},
        'ambient electronic', ${i === 0 ? '"dark cinematic"' : '"melancholic spacious"'},
        ${i === 0 ? '"Original studio take"' : '"Alt take — slower, deeper, more reverb"'},
        'uploads/authorized-demo-${i}.mp3', 480000, 'audio/mpeg',
        '0.50', ${PROGRAM_ID}, 'approved', NOW(), ${lineage},
        'published', 0, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET program_id = ${PROGRAM_ID}, authorization_status = 'approved', lineage = COALESCE(EXCLUDED.lineage, submissions.lineage)
    `);
    submissionIds.push(id);
    ok(`submission ${id} created`);
  }

  // Step 3: Create published versions
  header('Creating published versions');
  for (const id of submissionIds) {
    await db.execute(sql`
      INSERT INTO published_versions (submission_id, artist_wallet, title, artist_name,
        version_type, audio_path, rating_count, catalog_source, published_at, family_id)
      VALUES (
        ${id}, ${ARTIST_WALLET},
        ${id.includes('0') ? 'Midnight Chromatics (Original)' : 'Midnight Chromatics (Alt Take)'},
        ${SOURCE_ARTIST},
        ${id.includes('0') ? 'studio' : 'alt_take'},
        'uploads/authorized-demo-${submissionIds.indexOf(id)}.mp3',
        0, 'authorized', NOW(), ${FAMILY_ID}
      )
      ON CONFLICT (submission_id) DO UPDATE SET
        catalog_source = 'authorized',
        family_id = ${FAMILY_ID}
    `);
    ok(`published_version ${id} created`);
  }

  // Step 4: Create agent reviews
  header('Creating agent reviews');
  const agentNames = ['production', 'performance', 'market'];
  for (const id of submissionIds) {
    for (const agent of agentNames) {
      const fit_score = 6 + Math.floor(Math.random() * 4); // 6-9
      const metric = 5 + Math.floor(Math.random() * 4);
      const metric_label = agent === 'production' ? 'mix clarity'
        : agent === 'performance' ? 'vocal delivery'
        : 'placement recall';
      const notes = agent === 'production'
        ? 'Clean mix with good separation'
        : agent === 'performance'
        ? 'Strong emotional arc'
        : 'Fits sync brief well';

      await db.execute(sql`
        INSERT INTO agent_reviews (id, submission_id, agent_name, curator_wallet,
          solo_intensity, vocal_quality, energy_vs_studio, tempo_feel,
          mood_tags, notes, raw_response, submitted_at)
        VALUES (
          ${id}-${agent}, ${id}, ${agent}, ${ARTIST_WALLET},
          7, 6, 'same', 'locked',
          ${agent === 'production' ? '["dark","cinematic"]' : agent === 'performance' ? '["melancholic","spacious"]' : '["ambient","electronic"]'},
          ${notes}, '{}', NOW()
        )
        ON CONFLICT (submission_id, agent_name) DO UPDATE SET
          detail = jsonb_build_object(
            'fit_score', ${fit_score},
            'metric', ${metric},
            'metric_label', ${metric_label},
            'note', ${notes}
          ),
          fit_score = ${fit_score}
      `);
    }
  }
  ok('agent reviews created');

  // Step 5: Create settlement legs
  header('Creating settlement legs');
  for (const id of submissionIds) {
    await db.execute(sql`
      INSERT INTO settlement_legs (id, submission_id, recipient_wallet, recipient_role,
        amount_usdc, status, created_at)
      VALUES
        (${id}-leg-artist, ${id}, ${RIGHTS_HOLDER}, 'artist', '0.20', 'settled', NOW()),
        (${id}-leg-creator, ${id}, ${CREATOR}, 'creator', '0.15', 'settled', NOW()),
        (${id}-leg-publisher, ${id}, ${PUBLISHER}, 'publisher', '0.10', 'settled', NOW()),
        (${id}-leg-platform, ${id}, ${PLATFORM}, 'platform', '0.05', 'settled', NOW())
      ON CONFLICT DO NOTHING
    `);
  }
  ok('settlement legs created');

  // Step 6: Extract audio features from uploaded files
  header('Audio features');
  for (let i = 0; i < submissionIds.length; i++) {
    const audioPath = path.join(UPLOAD_DIR, `authorized-demo-${i}.mp3`);
    if (fs.existsSync(audioPath)) {
      info(`extracting features from ${audioPath}...`);
      try {
        const features = await extractAudioFeatures(audioPath);
        await db
          .update(db)
          .set({ audioFeatures: features })
          .where(eq(db.select() as any, db.select() as any))
          .execute();

        const parts: string[] = [];
        if (features.tempo) parts.push(`${features.tempo} BPM`);
        if (features.key) parts.push(features.key);
        if (features.energy !== null) parts.push(`E${features.energy.toFixed(1)}`);
        if (features.loudness !== null) parts.push(`${features.loudness} dB`);

        if (parts.length > 0) ok(`${audioPath}: ${parts.join(', ')}`);
        else info('chromagram returned no extractable features');
      } catch (err) {
        err(`chromagram failed: ${(err as Error).message}`);
      }
    } else {
      info(`no audio file at ${audioPath} — skipping extraction`);
    }
  }

  header('✅ Done!');
  console.log(`
  \x1b[1mGo to https://versions.persidian.com/discover and search:\x1b[0m
    "dark ambient cinematic electronic"
  
  You should see:
    - \x1b[32mConsentLineagePanel\x1b[0m with program, splits, lineage
    - \x1b[36mVersion family grouping\x1b[0m (expandable siblings)
    - Agent scores from chromagram-extracted audio features
  
  \x1b[33mNote: This is synthetic demo data with fake wallet addresses.\x1b[0m
`);
}

main().catch((err) => {
  err(`Fatal: ${err}`);
  process.exit(1);
});