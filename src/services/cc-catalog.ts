// MODULAR: CC catalog ingestion — pulls real CC-licensed tracks from the
// ccMixter adapter and lands them in the demo catalog so the supervisor
// search + scene card run against legitimate music, not just seed data.
//
// Every row is catalogSource 'demo' (illustrative, never licensable through
// the platform — the same rail the seed catalog uses). Idempotent: each
// track maps to a deterministic submissionId `ccmixter-<upload_id>`, so a
// re-run skips what already exists.
//
// Files are downloaded server-side into the uploads dir (Referer-protected,
// see adapters/ccmixter.ts) so the existing /api/v1/uploads route serves
// them and the AudioPlayer plays them.

import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import {
  users as usersTable,
  submissions as submissionsTable,
  publishedVersions as pvTable,
  placementBriefs as briefsTable,
} from "../lib/schema";
import { generateRatingCover } from "../lib/cover-gen";
import { ccArtistWallet, bucketCcTags, type CcMixterAdapter, type CcMixterTrack } from "../adapters/ccmixter";
import { log } from "../lib/logger";

export interface CcCatalogService {
  ingest: (opts?: { limit?: number; lic?: string }) => Promise<{
    ingested: number;
    skipped: number;
    failed: number;
    mock: boolean;
  }>;
}

export function createCcCatalogService({
  adapter,
  uploadDir,
}: {
  adapter: CcMixterAdapter;
  uploadDir: string;
}): CcCatalogService {
  async function ensureArtist(name: string): Promise<string> {
    const wallet = ccArtistWallet(name);
    await db
      .insert(usersTable)
      .values({ id: randomUUID(), walletAddress: wallet, displayName: name })
      .onConflictDoNothing({ target: usersTable.walletAddress });
    return wallet;
  }

  async function ingestOne(track: CcMixterTrack): Promise<"ingested" | "skipped" | "failed"> {
    const submissionId = `ccmixter-${track.uploadId}`;
    const [existing] = await db
      .select({ submissionId: pvTable.submissionId })
      .from(pvTable)
      .where(eq(pvTable.submissionId, submissionId))
      .limit(1);
    if (existing) return "skipped";

    const artistWallet = await ensureArtist(track.artistName);
    const filename = `ccmixter-${track.uploadId}.mp3`;
    const destPath = path.join(uploadDir, filename);
    try {
      await adapter.downloadFile(track, destPath);
    } catch (err) {
      log.warn("ccMixter download failed, skipping track", {
        uploadId: track.uploadId,
        err: err instanceof Error ? err.message : String(err),
      });
      return "failed";
    }
    const audioPath = `data/uploads/${filename}`;
    const sizeBytes =
      track.sizeBytes ?? (fs.existsSync(destPath) ? fs.statSync(destPath).size : 0);

    const { scene, instruments, arcs } = bucketCcTags(track.tags);
    const coverSvg = generateRatingCover({ title: track.title, moodTags: track.tags });
    const description = track.description ? track.description.slice(0, 500) : null;
    const attribution =
      `ccMixter upload ${track.uploadId} · ${track.licenseName}` +
      (track.pageUrl ? ` · ${track.pageUrl}` : "");

    // FK chain: users → submissions → published_versions → placement_briefs.
    await db.insert(submissionsTable).values({
      id: submissionId,
      artistWallet,
      title: track.title,
      artistName: track.artistName,
      versionType: track.versionType,
      genre: scene[0] ?? null,
      artistMood: arcs[0] ?? null,
      description,
      audioPath,
      audioDurationSeconds: track.durationSeconds,
      audioSizeBytes: sizeBytes,
      contentType: track.mimeType || "audio/mpeg",
      feeQuoteUsdc: "0.50",
      status: "published",
      ratingCount: 0,
      coverSvg,
    });

    await db.insert(pvTable).values({
      submissionId,
      artistWallet,
      title: track.title,
      artistName: track.artistName,
      versionType: track.versionType,
      audioPath,
      coverSvg,
      ratingCount: 0,
      catalogSource: "demo",
      aggregatedMoodTags: track.tags,
      publishedAt: new Date(),
    });

    await db.insert(briefsTable).values({
      id: randomUUID(),
      submissionId,
      agentName: "market",
      sceneTags: scene,
      instruments,
      emotionalArcs: arcs,
      syncComparables: [
        {
          name: `ccMixter · ${track.artistName}`,
          why: `CC-BY licensed original (${track.licenseName})`,
        },
      ],
      audienceSummary:
        (description ? `${description} — ` : "") + attribution,
    });

    return "ingested";
  }

  async function ingest(opts: { limit?: number; lic?: string } = {}) {
    const limit = Math.min(50, Math.max(1, opts.limit ?? 10));
    const tracks = await adapter.listTracks({ lic: opts.lic ?? "by", limit });
    let ingested = 0;
    let skipped = 0;
    let failed = 0;
    for (const track of tracks) {
      const result = await ingestOne(track);
      if (result === "ingested") ingested++;
      else if (result === "skipped") skipped++;
      else failed++;
    }
    return { ingested, skipped, failed, mock: adapter.mock };
  }

  return { ingest };
}
