#!/usr/bin/env npx tsx
/**
 * Migrate residual data/uploads/* audio to Grove and rewrite DB audio_path.
 *
 * Dry-run (default):
 *   npx tsx scripts/migrate-uploads-to-grove.ts
 *
 * Apply:
 *   npx tsx scripts/migrate-uploads-to-grove.ts --apply
 *
 * After successful apply, optionally delete local files:
 *   npx tsx scripts/migrate-uploads-to-grove.ts --apply --delete-local
 *
 * Requires DATABASE_URL + live Grove (GROVE_MOCK unset). On the box:
 *   docker exec -w /app versions … won't have this script; run from the
 *   git checkout with DATABASE_URL exported from the container env.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import { createGroveClient } from "../src/lib/ipfs";

const APPLY = process.argv.includes("--apply");
const DELETE_LOCAL = process.argv.includes("--delete-local");
const UPLOAD_DIR =
  process.env.UPLOAD_DIR ||
  path.resolve(process.cwd(), "data/uploads");

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mpeg": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
};

function log(msg: string) {
  console.log(msg);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL required");
  }
  if (process.env.GROVE_MOCK === "1") {
    throw new Error("Unset GROVE_MOCK — migrate needs live Grove");
  }

  const grove = createGroveClient({
    mock: false,
    chainId: Number(process.env.GROVE_CHAIN_ID || 232),
  });
  if (!grove.isConfigured()) {
    throw new Error("Grove not configured (GROVE_DISABLED?)");
  }

  if (!fs.existsSync(UPLOAD_DIR)) {
    log(`No upload dir at ${UPLOAD_DIR}`);
    return;
  }

  const files = fs
    .readdirSync(UPLOAD_DIR)
    .filter((f) => fs.statSync(path.join(UPLOAD_DIR, f)).isFile())
    .sort();

  log(
    `${APPLY ? "APPLY" : "DRY-RUN"} · ${files.length} files in ${UPLOAD_DIR}`,
  );

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let migrated = 0;
  let orphans = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (const name of files) {
      const full = path.join(UPLOAD_DIR, name);
      const localPath = `data/uploads/${name}`;
      const buf = fs.readFileSync(full);
      const sha = createHash("sha256").update(buf).digest("hex");
      const ext = path.extname(name).toLowerCase();
      const contentType = MIME[ext] || "application/octet-stream";

      const subs = await client.query<{ id: string; audio_path: string }>(
        `SELECT id, audio_path FROM submissions
         WHERE audio_path = $1 OR audio_path LIKE $2 OR audio_path LIKE $3`,
        [localPath, `%/${name}`, name],
      );
      const lists = await client.query<{ id: string; audio_path: string }>(
        `SELECT id, audio_path FROM listings
         WHERE audio_path = $1 OR audio_path LIKE $2 OR audio_path LIKE $3`,
        [localPath, `%/${name}`, name],
      );

      const refs = [
        ...subs.rows.map((r) => ({ table: "submissions" as const, ...r })),
        ...lists.rows.map((r) => ({ table: "listings" as const, ...r })),
      ];

      if (refs.length === 0) {
        orphans += 1;
        log(`  orphan  ${name} (${buf.length} B, sha=${sha.slice(0, 12)}…)`);
        if (APPLY && DELETE_LOCAL) {
          // Only delete orphans when explicitly asked — still gated on --apply
          fs.unlinkSync(full);
          log(`           deleted local orphan`);
        }
        continue;
      }

      // Already on Grove?
      if (refs.every((r) => r.audio_path.startsWith("lens://"))) {
        skipped += 1;
        log(`  skip    ${name} — rows already lens://`);
        if (APPLY && DELETE_LOCAL) {
          fs.unlinkSync(full);
          log(`           deleted local copy`);
        }
        continue;
      }

      log(
        `  migrate ${name} → ${refs.length} row(s) [${refs.map((r) => r.table).join(", ")}]`,
      );

      if (!APPLY) continue;

      try {
        const up = await grove.uploadAudio(buf, name, contentType);
        const lensUri = up.uri;

        for (const r of refs) {
          if (r.table === "submissions") {
            await client.query(
              `UPDATE submissions SET audio_path = $1 WHERE id = $2`,
              [lensUri, r.id],
            );
          } else {
            await client.query(
              `UPDATE listings SET audio_path = $1 WHERE id = $2`,
              [lensUri, r.id],
            );
          }
        }

        migrated += 1;
        log(`           ${lensUri}`);

        if (DELETE_LOCAL) {
          fs.unlinkSync(full);
          log(`           deleted local`);
        }
      } catch (e) {
        failed += 1;
        log(`  FAIL    ${name}: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }

  log(
    `\nDone. migrated=${migrated} orphans=${orphans} skipped=${skipped} failed=${failed} mode=${APPLY ? "apply" : "dry-run"}`,
  );
  if (!APPLY) {
    log("Re-run with --apply to upload + rewrite paths. Add --delete-local to free disk.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
