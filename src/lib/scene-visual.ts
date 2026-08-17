// MODULAR: Deterministic "scene card" SVG — a procedural storyboard panel
// generated from the agents' parsed brief (scene_tags / instruments /
// emotional_arcs / audience_summary) so a supervisor can SEE the scene the
// ranked tracks are being matched against before judging sync-fit.
//
// Zero marginal cost (no image-gen API): the panel is composed from the same
// signals the ranking agents already produce, so it doubles as agentic proof
// ("this is what the agents heard in your brief"). Pure + deterministic +
// dependency-free (deriveValence for palette, cover-gen's seeded PRNG), safe
// in Node (unit tests) and the browser.
//
// SECURITY: output only emits tags/attrs the shared sanitizer
// (cover-sanitize.ts) allows, and every interpolated string is escapeHtml'd —
// the SVG reaches dangerouslySetInnerHTML in SceneCard.
//
// Composition: sky (stars/moon for dark, sun for bright, clouds for neutral)
// → motion lines (density from chase/tense vs calm/dream keywords) → horizon
// → terrain silhouette (city skyline / ocean waves / forest trees / rolling
// hills, classified from scene keywords) → seeded instrument marks on the
// ground.

import { escapeHtml } from "@/lib/utils";
import { hashString, mulberry32, paletteFor } from "@/lib/cover-gen";

export interface SceneCardInput {
  briefText?: string;
  sceneTags?: string[];
  instruments?: string[];
  emotionalArcs?: string[];
  audienceSummary?: string;
}

export interface SceneCardOptions {
  width?: number;
  height?: number;
}

type Terrain = "city" | "ocean" | "forest" | "hills";
type Motion = "high" | "low" | "steady";

// MODULAR: keyword classifier — the agents' scene_tags/emotional_arcs are
// already normalized, so a small regex set is enough to pick a silhouette.
function classifyTerrain(sceneTags: string[], arcs: string[]): Terrain {
  const hay = [...sceneTags, ...arcs].join(" ").toLowerCase();
  if (/(city|skyline|urban|street|downtown|highway|neon|club)/.test(hay)) return "city";
  if (/(ocean|sea|beach|coast|surf|water|lake|river|wave|harbor)/.test(hay)) return "ocean";
  if (/(forest|woods|tree|mountain|hike|cabin|wild|meadow)/.test(hay)) return "forest";
  return "hills";
}

function classifyMotion(sceneTags: string[], arcs: string[]): Motion {
  const hay = [...sceneTags, ...arcs].join(" ").toLowerCase();
  if (/(chase|race|run|fast|tense|speed|urgent|rush|gallop|accelerat)/.test(hay)) return "high";
  if (/(slow|calm|sleep|float|drift|ambient|dream|still|soft|gentle)/.test(hay)) return "low";
  return "steady";
}

// MODULAR: scene valence from scene/arc/brief keywords. Separate from
// taste-graph's deriveValence, which speaks curator MOOD vocabulary
// ("Dreamy", "Warm") — scene tags like "night drive" / "tense" live in a
// different register and would otherwise fall through to neutral.
const DARK_SCENE =
  /(night|dark|tense|eerie|moody|noir|dusk|midnight|ominous|melanchol|sad|storm|gritty|shadow|rain|fog|haunt|brooding|slow[- ]burn|low[- ]light)/;
const BRIGHT_SCENE =
  /(sunny|bright|warm|joy|carefree|daylight|morning|cheerful|uplift|happy|sunshine|golden|spring|playful|sunrise)/;

function sceneValence(
  sceneTags: string[],
  arcs: string[],
  briefText?: string,
): "dark" | "bright" | "neutral" {
  const hay = [briefText, ...sceneTags, ...arcs].filter(Boolean).join(" ").toLowerCase();
  const dark = DARK_SCENE.test(hay);
  const bright = BRIGHT_SCENE.test(hay);
  if (dark && !bright) return "dark";
  if (bright && !dark) return "bright";
  return "neutral"; // both or neither — mixed signal, stay neutral
}

function round(n: number): string {
  return n.toFixed(1);
}

/**
 * MODULAR: generate the scene-card SVG string. Deterministic for the same
 * brief input. Returns a complete <svg> element with role="img" + an
 * escaped aria-label so it is announced, not just drawn.
 */
export function generateSceneCardSvg(
  input: SceneCardInput,
  options: SceneCardOptions = {},
): string {
  const w = options.width ?? 320;
  const h = options.height ?? 180;
  const seedText =
    input.briefText?.trim() ||
    input.sceneTags?.join(" ") ||
    input.audienceSummary?.trim() ||
    "scene";
  const rand = mulberry32(hashString(seedText));
  const valence = sceneValence(input.sceneTags ?? [], input.emotionalArcs ?? [], input.briefText);
  const pal = paletteFor(valence);
  const terrain = classifyTerrain(input.sceneTags ?? [], input.emotionalArcs ?? []);
  const motion = classifyMotion(input.sceneTags ?? [], input.emotionalArcs ?? []);

  const horizon = h * 0.66;
  const safeLabel = escapeHtml(seedText.slice(0, 60) || "scene");

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
      `preserveAspectRatio="xMidYMid meet" role="img" aria-label="Scene card for ${safeLabel}">`,
  );
  parts.push(`<rect width="${w}" height="${h}" fill="${pal.bg}"/>`);

  // ── Sky ────────────────────────────────────────────────
  if (valence === "dark") {
    const stars = 5 + Math.floor(rand() * 4);
    for (let i = 0; i < stars; i++) {
      const sx = rand() * w;
      const sy = rand() * horizon * 0.8;
      const sr = 0.7 + rand() * 1.4;
      parts.push(
        `<circle cx="${round(sx)}" cy="${round(sy)}" r="${round(sr)}" ` +
          `fill="${pal.fg}" fill-opacity="${(0.3 + rand() * 0.5).toFixed(2)}"/>`,
      );
    }
    // Crescent moon: light disc + a bg-colored cut to carve the crescent.
    const mx = w * (0.2 + rand() * 0.6);
    const my = h * (0.12 + rand() * 0.15);
    const mr = h * 0.05;
    parts.push(
      `<circle cx="${round(mx)}" cy="${round(my)}" r="${round(mr)}" fill="${pal.fg}" fill-opacity="0.92"/>`,
      `<circle cx="${round(mx - mr * 0.35)}" cy="${round(my - mr * 0.22)}" r="${round(mr)}" fill="${pal.bg}"/>`,
    );
  } else if (valence === "bright") {
    const sx = w * (0.2 + rand() * 0.5);
    const sy = h * (0.14 + rand() * 0.12);
    const r = h * 0.07;
    parts.push(
      `<circle cx="${round(sx)}" cy="${round(sy)}" r="${round(r)}" fill="${pal.accent}" fill-opacity="0.85"/>`,
    );
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const x1 = sx + Math.cos(ang) * (r + 4);
      const y1 = sy + Math.sin(ang) * (r + 4);
      const x2 = sx + Math.cos(ang) * (r + 9);
      const y2 = sy + Math.sin(ang) * (r + 9);
      parts.push(
        `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" ` +
          `stroke="${pal.accent}" stroke-opacity="0.5" stroke-width="1"/>`,
      );
    }
  } else {
    const clouds = 2 + Math.floor(rand() * 2);
    for (let c = 0; c < clouds; c++) {
      const cx = rand() * w * 0.8 + w * 0.05;
      const cy = h * (0.1 + rand() * 0.2);
      const cr = h * (0.03 + rand() * 0.03);
      parts.push(
        `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(cr * 1.4)}" fill="${pal.fg}" fill-opacity="0.14"/>`,
        `<circle cx="${round(cx + cr * 1.2)}" cy="${round(cy + cr * 0.3)}" r="${round(cr * 1.1)}" fill="${pal.fg}" fill-opacity="0.16"/>`,
        `<circle cx="${round(cx - cr * 1.1)}" cy="${round(cy + cr * 0.4)}" r="${round(cr * 0.95)}" fill="${pal.fg}" fill-opacity="0.14"/>`,
      );
    }
  }

  // ── Motion lines (energy of the scene) ─────────────────
  const motionLines = motion === "high" ? 6 : motion === "low" ? 1 : 3;
  for (let i = 0; i < motionLines; i++) {
    const y = rand() * horizon * 0.7 + h * 0.05;
    const x1 = rand() * w * 0.7;
    const len = h * (0.04 + rand() * 0.06);
    parts.push(
      `<line x1="${round(x1)}" y1="${round(y)}" x2="${round(x1 + len)}" y2="${round(y)}" ` +
        `stroke="${pal.fg}" stroke-opacity="${motion === "high" ? 0.4 : 0.18}" stroke-width="0.8"/>`,
    );
  }

  // ── Horizon ────────────────────────────────────────────
  parts.push(
    `<line x1="0" y1="${round(horizon)}" x2="${w}" y2="${round(horizon)}" ` +
      `stroke="${pal.fg}" stroke-opacity="0.2" stroke-width="0.6"/>`,
  );

  // ── Terrain silhouette ─────────────────────────────────
  if (terrain === "city") {
    let x = 0;
    while (x < w) {
      const bw = w * (0.05 + rand() * 0.07);
      const bh = h * (0.08 + rand() * 0.22);
      parts.push(
        `<rect x="${round(x)}" y="${round(horizon - bh)}" width="${round(bw)}" ` +
          `height="${round(bh + h - horizon)}" fill="${pal.fg}" fill-opacity="0.82"/>`,
      );
      x += bw + w * 0.02;
    }
  } else if (terrain === "ocean") {
    const wave = (offset: number, amp: number, opacity: number, fill: string) => {
      const pts: string[] = [];
      const segs = 14;
      for (let i = 0; i <= segs; i++) {
        const x = (i / segs) * w;
        const y = horizon + offset + Math.sin((i / segs) * Math.PI * 2 + rand() * 2) * h * amp;
        pts.push(`${round(x)},${round(y)}`);
      }
      parts.push(
        `<polygon points="${pts.join(" ")} ${w},${h} 0,${h}" fill="${fill}" fill-opacity="${opacity}"/>`,
      );
    };
    wave(0, 0.04, 0.85, pal.fg);
    wave(h * 0.12, 0.03, 0.5, pal.accent);
  } else {
    const pts: string[] = [];
    const segs = 12;
    for (let i = 0; i <= segs; i++) {
      const x = (i / segs) * w;
      const y = horizon + h * 0.03 + Math.sin((i / segs) * Math.PI * 2 + rand() * Math.PI) * h * 0.05;
      pts.push(`${round(x)},${round(y)}`);
    }
    parts.push(
      `<polygon points="${pts.join(" ")} ${w},${h} 0,${h}" fill="${pal.fg}" fill-opacity="0.85"/>`,
    );
    if (terrain === "forest") {
      const trees = 4 + Math.floor(rand() * 3);
      for (let t = 0; t < trees; t++) {
        const tx = rand() * w * 0.9;
        const th = h * (0.1 + rand() * 0.08);
        parts.push(
          `<polygon points="${round(tx)},${round(horizon - th)} ${round(tx + h * 0.03)},${round(horizon - th * 0.5)} ${round(tx - h * 0.03)},${round(horizon - th * 0.5)}" ` +
            `fill="${pal.accent}" fill-opacity="0.6"/>`,
        );
      }
    }
  }

  // ── Instrument marks (seeded glyphs on the ground) ─────
  const instCount = Math.min(4, input.instruments?.length ?? 0) || 2;
  for (let i = 0; i < instCount; i++) {
    const ix = w * (0.1 + rand() * 0.8);
    const iy = h * (0.78 + rand() * 0.12);
    const ir = h * (0.02 + rand() * 0.015);
    if (rand() > 0.5) {
      parts.push(
        `<circle cx="${round(ix)}" cy="${round(iy)}" r="${round(ir)}" fill="none" stroke="${pal.accent}" stroke-width="1.2"/>`,
      );
    } else {
      parts.push(
        `<line x1="${round(ix - ir)}" y1="${round(iy)}" x2="${round(ix + ir * 1.6)}" y2="${round(iy)}" stroke="${pal.accent}" stroke-width="1.2"/>`,
      );
    }
  }

  parts.push(`</svg>`);
  return parts.join("");
}
