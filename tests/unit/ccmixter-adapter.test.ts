// MODULAR: ccMixter adapter tests — mock mode is deterministic and offline,
// and tag bucketing splits system tags out of user tags into
// scene/instrument/mood buckets for the placement_briefs index.

import { describe, it, expect } from "vitest";
import {
  createCcMixterAdapter,
  parseCcTags,
  bucketCcTags,
  ccArtistWallet,
} from "../../src/adapters/ccmixter";

describe("ccMixter adapter (mock mode)", () => {
  it("is mock by default (no CCMIXTER_API_URL) and deterministic", async () => {
    const adapter = createCcMixterAdapter();
    expect(adapter.mock).toBe(true);
    const a = await adapter.listTracks({ limit: 3 });
    const b = await adapter.listTracks({ limit: 3 });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    expect(a[0].fileUrl).toContain("ccmixter.org");
  });
});

describe("parseCcTags", () => {
  it("strips system + bpm tags, keeps user tags", () => {
    const tags = parseCcTags(",media,remix,bpm_080_085,ccplus,attribution,audio,mp3,44k,stereo,CBR,instrumental,");
    expect(tags).toEqual(["instrumental"]);
  });

  it("lowercases and dedupes", () => {
    const tags = parseCcTags("Synth,DRUMS,synth,hip_hop");
    expect(tags).toEqual(["synth", "drums", "hip_hop"]);
  });
});

describe("bucketCcTags", () => {
  it("splits user tags into scene / instruments / arcs", () => {
    const { scene, instruments, arcs } = bucketCcTags([
      "synth",
      "drums",
      "tense",
      "night drive",
      "female_vocals",
    ]);
    expect(instruments).toContain("synth");
    expect(instruments).toContain("drums");
    expect(arcs).toContain("tense");
    expect(scene).toContain("night drive");
    expect(scene).not.toContain("synth");
  });
});

describe("ccArtistWallet", () => {
  it("derives a stable valid-format pseudo-wallet from an artist name", () => {
    const w = ccArtistWallet("Night Pilot");
    expect(w).toMatch(/^0x[0-9a-f]{40}$/);
    expect(ccArtistWallet("Night Pilot")).toBe(w);
    expect(ccArtistWallet("Other Artist")).not.toBe(w);
  });
});
