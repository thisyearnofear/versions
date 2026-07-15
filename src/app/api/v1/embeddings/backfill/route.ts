// MODULAR: Embeddings backfill route. Triggers a full-catalog backfill
// of CLAP audio embeddings for the supervisor inverse-search semantic
// layer. Processes all published versions that don't yet have an
// embedding row.
//
// POST /api/v1/embeddings/backfill — starts the backfill (synchronous;
// returns when complete or when the first error is logged). In mock
// mode the embeddings are deterministic hash-based vectors; in real
// mode this calls the configured EMBEDDING_API_URL for each track.
//
// GET /api/v1/embeddings/backfill — returns whether embeddings exist
// and the current mock/real mode status, so operators can check
// readiness before triggering a backfill.

import type { NextRequest } from 'next/server';
import {
  services,
  successResponse,
  errorResponse,
  corsPreflight,
  requestIdFor,
} from '@/lib/services';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return corsPreflight(requestIdFor(req));
}

export async function GET(req: NextRequest) {
  const rid = requestIdFor(req);
  const svc = services();
  try {
    const hasEmbeddings = await svc.embeddings.hasEmbeddings();
    return successResponse(200, {
      has_embeddings: hasEmbeddings,
      mock: svc.config.embeddingMock,
    }, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}

export async function POST(req: NextRequest) {
  const rid = requestIdFor(req);
  const svc = services();
  try {
    const result = await svc.embeddings.embedAllPublished();
    return successResponse(200, {
      embedded: result.embedded,
      skipped: result.skipped,
      mock: result.mock,
    }, rid);
  } catch (err) {
    return errorResponse(rid, 500, 'INTERNAL', (err as Error).message);
  }
}
