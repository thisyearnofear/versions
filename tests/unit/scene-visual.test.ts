// MODULAR: scene card generator tests — determinism, palette by valence,
// terrain classification, and hostile-input escaping (the SVG reaches
// dangerouslySetInnerHTML, so it must never emit script or break out of the
// aria-label).

import { describe, it, expect } from "vitest";
import { generateSceneCardSvg } from "../../src/lib/scene-visual";

const NIGHT_DRIVE = {
  briefText: "night drive through the city, tense",
  sceneTags: ["night drive", "city"],
  instruments: ["synth", "drums"],
  emotionalArcs: ["tense", "urgent"],
  audienceSummary: "A tense night drive through neon-lit streets.",
};

describe("generateSceneCardSvg", () => {
  it("returns a valid <svg> string", () => {
    const svg = generateSceneCardSvg(NIGHT_DRIVE);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("is deterministic for the same input", () => {
    expect(generateSceneCardSvg(NIGHT_DRIVE)).toBe(generateSceneCardSvg(NIGHT_DRIVE));
  });

  it("picks the dark palette for a night/tense brief", () => {
    expect(generateSceneCardSvg(NIGHT_DRIVE)).toContain('fill="#23233a"');
  });

  it("picks the bright palette for a bright brief", () => {
    const svg = generateSceneCardSvg({
      briefText: "sunny beach morning",
      sceneTags: ["beach", "sunny"],
      instruments: ["ukulele"],
      emotionalArcs: ["bright", "carefree"],
    });
    expect(svg).toContain('fill="#f2e3c3"');
  });

  it("renders a city skyline for city scenes", () => {
    expect(generateSceneCardSvg(NIGHT_DRIVE)).toContain("<rect");
  });

  it("renders layered waves for water scenes", () => {
    const svg = generateSceneCardSvg({
      briefText: "calm ocean at dusk",
      sceneTags: ["ocean"],
      instruments: ["piano"],
      emotionalArcs: ["calm"],
    });
    expect((svg.match(/<polygon/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("emits only sanitizer-allowed tags", () => {
    const svg = generateSceneCardSvg(NIGHT_DRIVE);
    const tags = Array.from(svg.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)/g), (m) => m[2]);
    const allowed = new Set(["svg", "rect", "circle", "line", "polygon", "path", "g"]);
    for (const tag of tags) {
      expect(allowed.has(tag)).toBe(true);
    }
  });

  it("escapes hostile brief text in the aria-label", () => {
    const svg = generateSceneCardSvg({
      briefText: '"><script>alert(1)</script>',
      sceneTags: [],
      instruments: [],
      emotionalArcs: [],
    });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});
