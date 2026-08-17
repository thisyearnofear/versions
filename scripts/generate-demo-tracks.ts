#!/usr/bin/env tsx
/**
 * Generate 1-2 demo tracks with the ElevenLabs Music API, tuned to briefs
 * that already return strong search results on prod. Saves MP3s to
 * .demo/tracks/ (gitignored) ready for `npm run ingest:tracks`.
 *
 * Prereq: ELEVENLABS_API_KEY in .env (or exported).
 * Run:    npx tsx scripts/generate-demo-tracks.ts
 */
import fs from "node:fs";
import path from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const client = new ElevenLabsClient();
const OUT_DIR = path.resolve(process.cwd(), ".demo", "tracks");

interface TrackPrompt {
  file: string;
  title: string;
  prompt: string;
  durationMs: number;
}

// Instrumentals tuned to briefs verified to search well on prod:
//   "warm piano vibraphone instrumental"  → 17 results, top match Speck
//   "tense car chase, no vocals, ~120 bpm" → 17 results
const TRACKS: TrackPrompt[] = [
  {
    file: "warm-piano-vibraphone.mp3",
    title: "Warm Keys at Dusk",
    prompt:
      "Warm intimate piano and vibraphone duet, gentle jazz waltz, soft brushed percussion, cozy and nostalgic, no vocals, 90 bpm, candlelit evening mood",
    durationMs: 30000,
  },
  {
    file: "tense-car-chase.mp3",
    title: "Redline Pursuit",
    prompt:
      "Tense driving cinematic instrumental, pulsing synth bass, urgent percussion, escalating action for a car chase scene, no vocals, 120 bpm, dark and propulsive",
    durationMs: 30000,
  },
];

async function generate(t: TrackPrompt): Promise<void> {
  const out = path.join(OUT_DIR, t.file);
  if (fs.existsSync(out) && fs.statSync(out).size > 10000) {
    console.log(`  ✓ ${t.title} — already exists (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
    return;
  }
  console.log(`  ⏳ ${t.title} — generating…`);
  try {
    const audio = await client.music.compose({
      prompt: t.prompt,
      musicLengthMs: t.durationMs,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of audio) chunks.push(Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(out, buffer);
    console.log(`  ✓ ${t.title} — saved ${(buffer.length / 1024).toFixed(0)} KB → ${path.relative(process.cwd(), out)}`);
  } catch (err) {
    console.error(`  ✗ ${t.title} — failed: ${(err as Error).message}`);
  }
}

async function main() {
  console.log("🎵 Generating demo tracks (ElevenLabs Music API)\n");
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("Error: ELEVENLABS_API_KEY not set. export it or add to .env");
    process.exit(1);
  }
  for (const t of TRACKS) await generate(t);
  console.log("\n✅ Next: npm run ingest:tracks -- --dir .demo/tracks");
  console.log("   (or add a tracks.json manifest for richer metadata first)");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
