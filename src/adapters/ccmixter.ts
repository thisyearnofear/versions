// MODULAR: ccMixter catalog adapter (mock-first). ccMixter's Query API 2.0
// (public, keyless) returns CC-licensed uploads; `lic=by` filters to
// Attribution (commercial-safe with credit). Note: Free Music Archive's API
// is shut down, so ccMixter is the live free-CC source.
//
// Files are Referer-protected (403 without a ccMixter referer), so browsers
// cannot stream them cross-origin — downloadFile fetches server-side with a
// ccMixter referer and writes into the uploads dir, where the existing
// /api/v1/uploads route serves them.
//
// Mock-first: without CCMIXTER_API_URL the adapter returns deterministic
// sample tracks and a silent-wav download (zero network), so the ingest
// pipeline runs and tests offline. Set CCMIXTER_API_URL to ingest live
// CC-BY tracks.

import { createHash } from "crypto";
import fs from "node:fs";
import path from "node:path";

export interface CcMixterTrack {
  uploadId: number;
  title: string;
  artistName: string;
  licenseName: string;
  licenseUrl: string;
  pageUrl: string;
  fileUrl: string;
  mimeType: string;
  durationSeconds: number | null;
  sizeBytes: number | null;
  description: string;
  /** Clean user tags (system/bpm tags stripped). */
  tags: string[];
  bpm: number | null;
  /** ccMixter is remix culture; most uploads are remixes/derivatives. */
  versionType: "remix" | "studio";
}

export interface CcMixterAdapter {
  mock: boolean;
  listTracks: (opts?: { lic?: string; limit?: number }) => Promise<CcMixterTrack[]>;
  /** Server-side download (Referer-spoofed) into destPath. */
  downloadFile: (track: CcMixterTrack, destPath: string) => Promise<void>;
}

// ── Tag normalization ──────────────────────────────────
// ccMixter upload_tags mix user tags (genre/mood/instrument) with system
// tags (attribution, audio, mp3, format, media, remix, ccplus, bpm_*).
const SYSTEM_TAGS = new Set([
  "attribution",
  "audio",
  "mp3",
  "44k",
  "stereo",
  "cbr",
  "vbr",
  "media",
  "remix",
  "ccplus",
  "sample",
  "acappella",
  "pdl",
  "noad",
]);

// Instrument-ish keywords (substring match) → placement_briefs.instruments.
const INSTRUMENT_KEYWORDS = [
  "bass", "drums", "guitar", "piano", "synth", "strings", "brass", "keys",
  "percussion", "vocal", "sax", "trumpet", "flute", "cello", "violin",
  "ukulele", "banjo", "harmonica", "organ", "bells", "pads", "lead", "arp",
  "kick", "snare", "hihat", "clap", "sub", "wobble", "pluck", "choir",
  "horn", "trombone", "clarinet", "oboe", "harp", "marimba", "vibraphone",
  "glockenspiel", "kalimba", "shaker", "tambourine", "cymbal", "toms",
  "rhodes", "wurlitzer", "clav", "mandolin", "fiddle", "accordion", "sitar",
  "tabla", "djembe", "conga", "bongo", "steel_drum",
];

// Mood-ish keywords (substring match) → placement_briefs.emotional_arcs.
const MOOD_KEYWORDS = [
  "dark", "moody", "happy", "sad", "dreamy", "chill", "ambient", "energetic",
  "aggressive", "calm", "tense", "uplifting", "melancholic", "romantic",
  "playful", "eerie", "warm", "cold", "gritty", "soft", "hard", "epic",
  "mellow", "hypnotic", "nostalgic", "hopeful", "somber", "joyful",
  "mysterious", "ethereal", "groovy", "funky", "soulful", "jazzy", "bluesy",
  "trippy", "psychedelic", "minimal", "lush", "sparse", "bright", "nocturnal",
  "cinematic", "introspective", "dramatic", "serene", "peaceful", "restless",
  "driving", "laidback", "laid-back", "upbeat",
];

export function parseCcTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
        .filter((t) => !SYSTEM_TAGS.has(t))
        .filter((t) => !t.startsWith("bpm_")),
    ),
  ).slice(0, 20);
}

export function bucketCcTags(tags: string[]): {
  scene: string[];
  instruments: string[];
  arcs: string[];
} {
  const scene: string[] = [];
  const instruments: string[] = [];
  const arcs: string[] = [];
  for (const tag of tags) {
    if (INSTRUMENT_KEYWORDS.some((k) => tag.includes(k))) {
      if (instruments.length < 6) instruments.push(tag);
    } else if (MOOD_KEYWORDS.some((k) => tag.includes(k))) {
      if (arcs.length < 5) arcs.push(tag);
    } else if (scene.length < 8) {
      scene.push(tag);
    }
  }
  return { scene, instruments, arcs };
}

function parseDuration(ps: string | undefined): number | null {
  if (!ps) return null;
  const parts = ps.split(":").map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

// ── Raw API row shape (Query API 2.0, f=json, dataview=default) ──
interface CcRawRow {
  upload_id: number;
  upload_name: string;
  user_name?: string;
  user_real_name?: string;
  license_name?: string;
  license_url?: string;
  file_page_url?: string;
  upload_description_plain?: string;
  upload_tags?: string;
  upload_extra?: { bpm?: number };
  files?: Array<{
    download_url?: string;
    file_rawsize?: number;
    file_format_info?: { mime_type?: string; ps?: string };
  }>;
}

function normalizeRow(row: CcRawRow): CcMixterTrack | null {
  const file = row.files?.find((f) => f.download_url);
  if (!file?.download_url) return null;
  const rawTags = `${row.upload_tags ?? ""}`;
  const tags = parseCcTags(rawTags);
  return {
    uploadId: row.upload_id,
    title: row.upload_name || `ccMixter ${row.upload_id}`,
    artistName: row.user_real_name || row.user_name || "ccMixter artist",
    licenseName: row.license_name || "Attribution",
    licenseUrl: row.license_url || "https://creativecommons.org/licenses/by/3.0/",
    pageUrl: row.file_page_url || "",
    fileUrl: file.download_url,
    mimeType: file.file_format_info?.mime_type || "audio/mpeg",
    durationSeconds: parseDuration(file.file_format_info?.ps),
    sizeBytes: file.file_rawsize ?? null,
    description: (row.upload_description_plain || "").replace(/\r\n/g, " ").trim(),
    tags,
    bpm: row.upload_extra?.bpm ?? null,
    versionType: /remix/.test(rawTags) ? "remix" : "studio",
  };
}

// ── Mock mode ──────────────────────────────────────────
// Deterministic sample tracks so the pipeline (and tests) run offline with
// zero network. Clearly labeled mock in the ingest output.
function mockTracks(): CcMixterTrack[] {
  return [
    {
      uploadId: 71077,
      title: "Lost Roamin'",
      artistName: "Speck",
      licenseName: "Attribution (3.0)",
      licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
      pageUrl: "https://ccmixter.org/files/speck/71077",
      fileUrl: "https://ccmixter.org/content/speck/speck_-_Lost_Roamin_1.mp3",
      mimeType: "audio/mpeg",
      durationSeconds: 206,
      sizeBytes: 6582066,
      description: "MOCK — piano, vibraphone, synth and drums, CC-BY.",
      tags: ["instrumental", "piano", "drums", "synth", "warm"],
      bpm: 80,
      versionType: "remix",
    },
    {
      uploadId: 71068,
      title: "M.U.S.T.A.N.G Beats",
      artistName: "Gabriel Shelligton",
      licenseName: "Attribution (3.0)",
      licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
      pageUrl: "https://ccmixter.org/files/gabriel_shelligton/71068",
      fileUrl: "https://ccmixter.org/content/gabriel_shelligton/71068.mp3",
      mimeType: "audio/mpeg",
      durationSeconds: 183,
      sizeBytes: 4211000,
      description: "MOCK — female vocals, bass, hip hop chords.",
      tags: ["female_vocals", "bass", "hip_hop", "chords", "groovy"],
      bpm: 112,
      versionType: "remix",
    },
    {
      uploadId: 71001,
      title: "Glass Morning",
      artistName: "Paper Birds",
      licenseName: "Attribution (3.0)",
      licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
      pageUrl: "https://ccmixter.org/files/paper_birds/71001",
      fileUrl: "https://ccmixter.org/content/paper_birds/71001.mp3",
      mimeType: "audio/mpeg",
      durationSeconds: 198,
      sizeBytes: 4750000,
      description: "MOCK — bright acoustic indie-folk.",
      tags: ["acoustic", "guitar", "hopeful", "bright", "ukulele"],
      bpm: 96,
      versionType: "studio",
    },
  ];
}

function makeSilentWav(durationSeconds = 1): Buffer {
  const sampleRate = 8000;
  const dataLength = durationSeconds * sampleRate * 2;
  const buf = Buffer.alloc(44 + dataLength);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataLength, 40);
  return buf;
}

export function createCcMixterAdapter(opts?: { apiUrl?: string }): CcMixterAdapter {
  const apiUrl = opts?.apiUrl ?? process.env.CCMIXTER_API_URL ?? "";
  const mock = apiUrl.length === 0;

  return {
    mock,
    async listTracks({ lic = "by", limit = 10 } = {}) {
      if (mock) return mockTracks();
      const url = `${apiUrl}?f=json&limit=${Math.min(50, Math.max(1, limit))}&lic=${encodeURIComponent(lic)}&sort=date`;
      const res = await fetch(url, { headers: { "User-Agent": "versions-catalog-ingest/0.1" } });
      if (!res.ok) throw new Error(`ccMixter API returned ${res.status}`);
      const rows = (await res.json()) as CcRawRow[];
      return rows.map(normalizeRow).filter((t): t is CcMixterTrack => t !== null);
    },
    async downloadFile(track, destPath) {
      if (mock) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, makeSilentWav(1));
        return;
      }
      // Referer-spoofed server-side fetch: ccMixter blocks cross-site
      // streaming (403 without a ccMixter referer).
      const res = await fetch(track.fileUrl, {
        headers: { Referer: "https://ccmixter.org/", "User-Agent": "versions-catalog-ingest/0.1" },
      });
      if (!res.ok) throw new Error(`ccMixter file ${res.status} for upload ${track.uploadId}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, buf);
    },
  };
}

// MODULAR: deterministic pseudo-wallet from an artist name (mirrors the
// guest-id derivation) so each ccMixter artist maps to one stable row.
export function ccArtistWallet(name: string): string {
  const digest = createHash("sha256").update(name).digest("hex");
  return `0x${digest.slice(0, 40)}`;
}
