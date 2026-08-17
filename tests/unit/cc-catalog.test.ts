// MODULAR: ccMixter catalog ingestion tests. The service lands real CC-BY
// tracks into the demo catalog: users → submissions → published_versions
// (catalogSource 'demo') → placement_briefs, idempotently. The adapter is
// faked so tests never touch the network or the filesystem (tracks carry
// sizeBytes, so downloadFile is a no-op).

import { eq } from "drizzle-orm";
import type { CcMixterAdapter } from "../../src/adapters/ccmixter";

const { initTestDb, getTestDb, resetTestDb } = await import("../helpers/db");
const { vi, describe, it, expect, beforeAll, beforeEach } = await import("vitest");
vi.mock("@/lib/db", () => {
  return { get db() { return getTestDb(); } };
});

const { createCcCatalogService } = await import("../../src/services/cc-catalog");
const { ccArtistWallet } = await import("../../src/adapters/ccmixter");
const {
  users: usersTable,
  submissions: submissionsTable,
  publishedVersions: pvTable,
  placementBriefs: briefsTable,
} = await import("../../src/lib/schema");

const FAKE_TRACKS = [
  {
    uploadId: 1,
    title: "Neon Drive",
    artistName: "Night Pilot",
    licenseName: "Attribution (3.0)",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    pageUrl: "https://ccmixter.org/files/night_pilot/1",
    fileUrl: "https://ccmixter.org/content/night_pilot/1.mp3",
    mimeType: "audio/mpeg",
    durationSeconds: 180,
    sizeBytes: 3000000,
    description: "A synthwave chase through the city.",
    tags: ["synth", "drums", "tense", "night drive"],
    bpm: 120,
    versionType: "remix",
  },
];

function fakeAdapter(): CcMixterAdapter {
  return {
    mock: true,
    listTracks: async () => FAKE_TRACKS,
    downloadFile: async () => {}, // sizeBytes is set — no fs access needed
  };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("ccMixter catalog ingestion", () => {
  it("lands a track in the demo catalog with a placement brief", async () => {
    const service = createCcCatalogService({ adapter: fakeAdapter(), uploadDir: "/tmp/cc-test" });
    const result = await service.ingest({ limit: 5 });

    expect(result).toEqual({ ingested: 1, skipped: 0, failed: 0, mock: true });

    const db = getTestDb();
    const [pv] = await db.select().from(pvTable).where(eq(pvTable.submissionId, "ccmixter-1"));
    expect(pv).toBeDefined();
    expect(pv.title).toBe("Neon Drive");
    expect(pv.artistName).toBe("Night Pilot");
    expect(pv.catalogSource).toBe("demo");
    expect(pv.audioPath).toBe("data/uploads/ccmixter-1.mp3");
    expect(pv.versionType).toBe("remix");

    const [sub] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, "ccmixter-1"));
    expect(sub).toBeDefined();
    expect(sub.status).toBe("published");

    const [artist] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.walletAddress, ccArtistWallet("Night Pilot")));
    expect(artist).toBeDefined();

    const [brief] = await db.select().from(briefsTable).where(eq(briefsTable.submissionId, "ccmixter-1"));
    expect(brief).toBeDefined();
    expect(brief.sceneTags).toContain("night drive");
    expect(brief.instruments).toEqual(expect.arrayContaining(["synth", "drums"]));
    expect(brief.emotionalArcs).toContain("tense");
    expect(brief.audienceSummary).toContain("Attribution");
  });

  it("is idempotent — a re-run skips existing tracks", async () => {
    const service = createCcCatalogService({ adapter: fakeAdapter(), uploadDir: "/tmp/cc-test" });
    const first = await service.ingest({ limit: 5 });
    expect(first.ingested).toBe(1);

    const second = await service.ingest({ limit: 5 });
    expect(second).toEqual({ ingested: 0, skipped: 1, failed: 0, mock: true });

    const db = getTestDb();
    const rows = await db.select().from(pvTable);
    expect(rows).toHaveLength(1);
  });

  it("counts a failed download as failed and skips the row", async () => {
    const adapter = fakeAdapter();
    adapter.downloadFile = async () => {
      throw new Error("403 from ccMixter");
    };
    const service = createCcCatalogService({ adapter, uploadDir: "/tmp/cc-test" });
    const result = await service.ingest({ limit: 5 });
    expect(result).toEqual({ ingested: 0, skipped: 0, failed: 1, mock: true });

    const db = getTestDb();
    const rows = await db.select().from(pvTable);
    expect(rows).toHaveLength(0);
  });
});
