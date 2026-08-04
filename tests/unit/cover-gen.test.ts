// MODULAR: cover-gen tests — the deterministic rating-driven cover
// generator (src/lib/cover-gen.ts). Covers the pure contracts: valid
// SVG, determinism, palette selection by valence, amplitude response,
// bar density by tempo, and the seeded-PRNG stability.

import { describe, it, expect } from "vitest";
import { hashString, mulberry32, generateRatingCover } from "@/lib/cover-gen";

describe("hashString", () => {
  it("is deterministic", () => {
    expect(hashString("Neon Dreams")).toBe(hashString("Neon Dreams"));
  });

  it("differs for different titles", () => {
    expect(hashString("Neon Dreams")).not.toBe(hashString("Autumn Leaves"));
  });
});

describe("mulberry32", () => {
  it("produces values in [0, 1)", () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });
});

describe("generateRatingCover", () => {
  it("returns a valid <svg> string", () => {
    const svg = generateRatingCover({ title: "Neon Dreams" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg.includes("<path")).toBe(true);
  });

  it("is deterministic for identical input", () => {
    const input = { title: "Neon Dreams", avgSolo: 8, avgVocal: 7, energy: "higher", tempo: "rushing" };
    expect(generateRatingCover(input)).toBe(generateRatingCover(input));
  });

  it("picks the dark palette for dark valence", () => {
    const svg = generateRatingCover({ title: "X", valence: "dark" });
    expect(svg).toContain("fill=\"#23233a\"");
  });

  it("picks the bright palette for bright valence", () => {
    const svg = generateRatingCover({ title: "X", valence: "bright" });
    expect(svg).toContain("fill=\"#f2e3c3\"");
  });

  it("defaults to the neutral house palette", () => {
    const svg = generateRatingCover({ title: "X" });
    expect(svg).toContain("fill=\"#f4efe5\"");
  });

  it("raises amplitude when energy is higher (taller wave path)", () => {
    const low = generateRatingCover({ title: "T", avgSolo: 5, avgVocal: 5, energy: "lower" });
    const high = generateRatingCover({ title: "T", avgSolo: 5, avgVocal: 5, energy: "higher" });
    // Count the numeric y-coordinates that reach close to the top half
    const reach = (s: string) =>
      (s.match(/\d+\.\d+/g) ?? []).map(Number).filter((n) => n < 40).length;
    expect(reach(high)).toBeGreaterThan(reach(low));
  });

  it("varies bar count with tempo", () => {
    const sparse = generateRatingCover({ title: "T", tempo: "dragging" });
    const dense = generateRatingCover({ title: "T", tempo: "rushing" });
    const pathOf = (s: string) => (s.match(/<path d="([^"]+)"/) ?? [])[1] ?? "";
    expect(pathOf(dense).split("L").length).toBeGreaterThan(pathOf(sparse).split("L").length);
  });

  it("renders accent rings for mood-tagged tracks", () => {
    const svg = generateRatingCover({ title: "T", moodTags: ["Dreamy", "Polished", "Warm"] });
    expect(svg).toContain("<circle");
  });

  it("respects a custom size", () => {
    const svg = generateRatingCover({ title: "T", moodTags: [] }, { size: 120 });
    expect(svg).toContain("viewBox=\"0 0 120 120\"");
  });

  it("escapes hostile titles in the aria-label (XSS guard)", () => {
    // MODULAR: regression — titles are user metadata and the SVG
    // reaches dangerouslySetInnerHTML (and the SSR sanitize path
    // returns raw markup), so a breakout title must not survive.
    const hostile = '" onload="alert(1)';
    const svg = generateRatingCover({ title: hostile });
    expect(svg).not.toContain('onload="');
    expect(svg).toContain("aria-label=\"Cover art for &quot; onload=&quot;alert(1)\"");
    // And the simpler angle-bracket form:
    const svg2 = generateRatingCover({ title: "<script>alert(1)</script>" });
    expect(svg2).not.toContain("<script>");
    expect(svg2).toContain("&lt;script&gt;");
  });
});
