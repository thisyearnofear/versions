// MODULAR: Ingest real CC-licensed tracks from ccMixter into the demo
// catalog (published_versions, catalogSource 'demo') so the supervisor
// search + scene card run against legitimate music, not just seed data.
//
// Mock-first: without CCMIXTER_API_URL the adapter returns deterministic
// sample tracks and writes silent-wav placeholders (zero network), so the
// pipeline is testable offline. Set CCMIXTER_API_URL to ingest live CC-BY
// tracks:
//
//   CCMIXTER_API_URL=https://ccmixter.org/api/query npx tsx scripts/ingest-ccmixter.ts 10
//
// Files are Referer-protected, so they are downloaded server-side (with a
// ccMixter referer) into the uploads dir — the existing /api/v1/uploads
// route serves them and the AudioPlayer plays them.
//
// Run:   npx tsx scripts/ingest-ccmixter.ts [limit]
//        DATABASE_URL=postgres://... npx tsx scripts/ingest-ccmixter.ts 10

import fs from "node:fs";
import path from "node:path";
import { createCcMixterAdapter } from "../src/adapters/ccmixter";
import { createCcCatalogService } from "../src/services/cc-catalog";
import { createEmbeddingAdapter } from "../src/adapters/embedding";
import { createEmbeddingService } from "../src/services/embeddings";
import { resolveEmbeddingConfig } from "../src/lib/openrouter";

function uploadDir(): string {
  return (
    process.env.UPLOAD_DIR ||
    (process.env.VERCEL ? "/tmp/uploads" : path.resolve(process.cwd(), "data", "uploads"))
  );
}

async function main() {
  const limit = Number(process.argv[2]) || 10;
  const adapter = createCcMixterAdapter();
  const dir = uploadDir();
  fs.mkdirSync(dir, { recursive: true });
  const service = createCcCatalogService({ adapter, uploadDir: dir });

  console.log(
    `🎵 Ingesting ccMixter tracks (${adapter.mock ? "MOCK" : "LIVE"} mode, limit ${limit})...\n`,
  );
  const result = await service.ingest({ limit });
  console.log(
    `\n✅ Done: ${result.ingested} ingested, ${result.skipped} skipped, ${result.failed} failed (${result.mock ? "mock" : "live"}).`,
  );
  console.log("   Ingested rows are catalogSource 'demo' — illustrative, not licensable.");

  // Backfill version embeddings so the new tracks are searchable via the
  // semantic (pgvector) path too, not just the structured-tag fallback.
  // Idempotent: embedAllPublished only touches versions missing a row.
  // Uses the SAME adapter resolution as the server registry (services.ts)
  // so the vectors live in the same space as the query embeddings. Runs on
  // every invocation (idempotent) so re-runs self-heal any missing rows.
  {
    const embedCfg = resolveEmbeddingConfig();
    const emb = await createEmbeddingService(
      createEmbeddingAdapter({
        provider: embedCfg.provider,
        apiUrl: embedCfg.apiUrl || undefined,
        apiKey: embedCfg.apiKey || undefined,
        model: embedCfg.model,
        audioCapable: embedCfg.audioCapable,
      }),
    ).embedAllPublished();
    console.log(
      `\n🧭 Embeddings: ${emb.embedded} embedded, ${emb.skipped} skipped (${emb.mock ? "mock" : "live"}, text-only: ${!embedCfg.audioCapable}).`,
    );
  }

  // Force-exit: the pg Pool keeps the event loop alive otherwise.
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Ingest failed:", err);
  process.exit(1);
});
