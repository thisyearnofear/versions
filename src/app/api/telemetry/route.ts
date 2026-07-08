// MODULAR: Telemetry beacon endpoint. Receives client-side funnel
// events from the analytics module (src/lib/analytics.ts) and
// logs them via the structured logger so they land in the same
// log pipeline as server-side events.
//
// POST /api/telemetry — fire-and-forget from sendBeacon.
// No DB writes, no external service calls. Just structured logs.
//
// PERFORMANT: single JSON parse + log.info per batch. No rate
// limiting needed — the payload is tiny and sendBeacon is
// inherently throttled by the browser.

import { randomUUID } from "crypto";
import { log } from "@/lib/logger";
import { successResponse, errorResponse } from "@/lib/services";
import { db } from "@/lib/db";
import { telemetryEvents } from "@/lib/schema";

export const dynamic = "force-dynamic";

interface TelemetryBatch {
  session: string;
  referrer: string | null;
  path: string | null;
  events: Array<{
    event: string;
    props: Record<string, unknown>;
    ts: string;
  }>;
}

export async function POST(req: Request): Promise<Response> {
  // MODULAR: inline UUID instead of casting Request → NextRequest.
  const rid = req.headers.get("x-request-id")?.trim() || randomUUID();

  try {
    const body = (await req.json()) as TelemetryBatch;

    if (!body || !Array.isArray(body.events)) {
      return errorResponse(rid, 400, "INVALID_BODY", "expected { events: [] }");
    }

    // Log each event as a structured line AND persist to the
    // telemetry_events table so the funnel can be queried via
    // /api/v1/funnel. The DB write is batched (single insert with
    // multiple values) so the beacon stays fast. If the DB write
    // fails, we still log — analytics should never break the app.
    const rows = body.events.map((evt) => ({
      id: randomUUID(),
      session: body.session,
      event: evt.event,
      path: body.path,
      referrer: body.referrer,
      // MODULAR: defensive ?? {} — a malformed beacon could omit
      // props or send it as undefined; the DB column is NOT NULL
      // with a default({}), but Drizzle's default only applies
      // when the column is absent from the insert object, not
      // when it's explicitly undefined.
      props: evt.props ?? {},
      clientTs: evt.ts ? new Date(evt.ts) : null,
    }));

    for (const evt of body.events) {
      log.info("telemetry", {
        session: body.session,
        event: evt.event,
        path: body.path,
        referrer: body.referrer,
        props: evt.props,
        client_ts: evt.ts,
      });
    }

    try {
      await db.insert(telemetryEvents).values(rows);
    } catch (dbErr) {
      // DB write failed — log but don't fail the beacon. The events
      // are already in the structured log pipeline as a fallback.
      log.warn("telemetry persist failed", {
        error: (dbErr as Error).message,
        count: rows.length,
      });
    }

    return successResponse(200, { received: body.events.length }, rid);
  } catch (err) {
    return errorResponse(rid, 500, "INTERNAL", (err as Error).message);
  }
}
