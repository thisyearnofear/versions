#!/usr/bin/env node
// MODULAR: Pilot audio feature extraction script.
//
// Walks submissions that have audio but no audio_features, extracts features
// from each audio file, and writes them to the database. Designed as a
// one-off pilot script (concierge) — not part of the critical publish path.
//
// Usage:
//   npm run extract:features [submissionId]
//
// With no args: extracts all submissions without features.
// With a submissionId: extracts just that one (for targeted pilot tests).

import { eq, isNull } from 'drizzle-orm';
import { db } from './src/lib/db';
import { submissions } from './src/lib/schema';
import { extractAudioFeatures } from './src/lib/audio-features';
import { config } from './src/lib/config';

async function extractOne(submissionId: string) {
  const [sub] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);

  if (!sub) {
    console.error(`Submission ${submissionId} not found`);
    process.exit(1);
  }

  if (sub.audioFeatures) {
    console.log(`Submission ${submissionId} already has features — skipping`);
    return;
  }

  const audioPath = sub.audioPath;
  console.log(`Extracting features from ${audioPath}...`);

  try {
    const features = await extractAudioFeatures(audioPath, config.llmApiKey, config.embeddingApiUrl);
    await db
      .update(submissions)
      .set({ audioFeatures: features })
      .where(eq(submissions.id, submissionId));
    console.log(`  ✓ Features extracted and stored for ${submissionId}`);
    if (features.tempo) console.log(`    tempo: ${features.tempo} BPM`);
    if (features.key) console.log(`    key: ${features.key}`);
    if (features.energy !== null) console.log(`    energy: ${features.energy.toFixed(2)}`);
    if (features.danceability !== null) console.log(`    danceability: ${features.danceability.toFixed(2)}`);
  } catch (err) {
    console.error(`  ✗ Failed for ${submissionId}: ${err}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const submissionId = args[0];

  if (submissionId) {
    await extractOne(submissionId);
    return;
  }

  // Extract all submissions without features
  const subs = await db
    .select({ id: submissions.id, audioPath: submissions.audioPath })
    .from(submissions)
    .where(isNull(submissions.audioFeatures));

  console.log(`Found ${subs.length} submissions without audio features.`);

  for (const sub of subs) {
    await extractOne(sub.id);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});