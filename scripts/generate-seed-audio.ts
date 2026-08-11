/**
 * Generate seed audio using ElevenLabs Music API.
 *
 * Prerequisites:
 *   npm install @elevenlabs/elevenlabs-js
 *   export ELEVENLABS_API_KEY="your-key"
 *
 * Run:
 *   npx tsx scripts/generate-seed-audio.ts
 *
 * Generates 30-second clips for each seed track, saves as MP3 in
 * data/uploads/ with the same naming convention the seed-catalog uses.
 */

import fs from "node:fs";
import path from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const client = new ElevenLabsClient();

const UPLOAD_DIR = path.resolve(process.cwd(), "data", "uploads");

interface TrackPrompt {
  id: string;
  title: string;
  prompt: string;
  durationMs: number;
}

const TRACKS: TrackPrompt[] = [
  {
    id: "demo-pending-0001-0000-000000000001",
    title: "Midnight Blues",
    prompt:
      "A raw blues-rock demo, single electric guitar, gritty and soulful, recorded live in a studio at 3am, slightly distorted tube amp, no drums, melancholic and honest",
    durationMs: 30000,
  },
  {
    id: "demo-published-0002-0000-000000000002",
    title: "Neon Dreams",
    prompt:
      "Atmospheric electronic music, dreamy synth pads, pulsing bass, festival energy building to a melodic peak, no vocals, 128 bpm, euphoric and spacious",
    durationMs: 30000,
  },
  {
    id: "demo-published-0003-0000-000000000003",
    title: "Autumn Leaves",
    prompt:
      "Intimate acoustic folk, fingerpicked guitar, warm and melancholic, close-mic recording with natural room reverb, gentle and vulnerable, no percussion",
    durationMs: 30000,
  },
  {
    id: "demo-published-0004-0000-000000000004",
    title: "Street Poetry",
    prompt:
      "Gritty alternative hip-hop with live band arrangement, punchy brass hits, aggressive compressed vocals over a boom-bap beat, raw energy, commanding delivery",
    durationMs: 30000,
  },
  {
    id: "demo-published-0005-0000-000000000005",
    title: "Chrome Sunset",
    prompt:
      "Synthwave with analog warmth, gated reverb snare, wide stereo synths, steady driving rhythm, nostalgic retro feel, no vocals, 110 bpm, cinematic night-drive energy",
    durationMs: 30000,
  },
  {
    id: "demo-published-0006-0000-000000000006",
    title: "Dust & Diesel",
    prompt:
      "Americana live recording in a highway bar, steel guitar, earnest male vocal, room noise and ambience, honest and grounded, slightly dragging tempo, heartland feel",
    durationMs: 30000,
  },
  {
    id: "demo-published-0007-0000-000000000007",
    title: "Velvet Static",
    prompt:
      "Sultry slow R&B with tape-warped production, intimate female vocal, fuzz bass, warm analog keys, sensual and restrained, low-slung groove, late-night mood",
    durationMs: 30000,
  },
  {
    id: "demo-published-0008-0000-000000000008",
    title: "Glass Morning",
    prompt:
      "Bright optimistic indie-folk, fingerpicked acoustic guitar, close warm vocal, birds in the background, hopeful and gentle, sunlit morning energy, no heavy drums",
    durationMs: 30000,
  },
];

async function generateTrack(track: TrackPrompt): Promise<void> {
  const filename = `seed-${track.id}.mp3`;
  const outputPath = path.join(UPLOAD_DIR, filename);

  // Skip if already generated
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
    console.log(`  ✓ ${track.title} — already exists (${(fs.statSync(outputPath).size / 1024).toFixed(0)} KB)`);
    return;
  }

  console.log(`  ⏳ ${track.title} — generating...`);

  try {
    const audio = await client.music.compose({
      prompt: track.prompt,
      musicLengthMs: track.durationMs,
    });

    // The response is a ReadableStream or async iterable of chunks
    const chunks: Buffer[] = [];
    for await (const chunk of audio) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    console.log(`  ✓ ${track.title} — saved (${(buffer.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.error(`  ✗ ${track.title} — failed: ${(err as Error).message}`);
  }
}

async function main() {
  console.log("🎵 Generating seed audio with ElevenLabs Music API\n");

  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("Error: ELEVENLABS_API_KEY not set.");
    console.error("Run: export ELEVENLABS_API_KEY='your-key'");
    process.exit(1);
  }

  for (const track of TRACKS) {
    await generateTrack(track);
  }

  console.log("\n✅ Done. Now update audioDurationSeconds in scripts/seed-catalog.ts to 30 for each track.");
  console.log("   Then re-run: npx tsx scripts/seed-catalog.ts");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
