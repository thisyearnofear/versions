// MODULAR: site-level Open Graph card, generated at build time by
// next/og (satori). Static — no request-time APIs, no DB reads — so it
// is statically optimized and cached. Brand tokens mirror globals.css
// (paper / ink / rust). Satori only supports flexbox and a CSS subset,
// so layout stays deliberately simple.

import { ImageResponse } from "next/og";

export const alt =
  "VERSIONS — ad infra for AI-run distribution. Music and product placements matched to a channel's ethos, free with attribution or paid as a sponsor slot, settled 60/30/10 in USDC on Arc.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#f4efe5";
const PAPER_2 = "#ebe3d6";
const INK = "#1a1a1a";
const INK_2 = "#4a4a4a";
const INK_3 = "#8a8a8a";
const RUST = "#c84a1f";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          padding: "64px 72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 14,
              background: RUST,
            }}
          />
          <div
            style={{
              fontSize: 22,
              letterSpacing: 4,
              color: INK_2,
              textTransform: "uppercase",
            }}
          >
            Ad infra for AI-run distribution
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontSize: 110,
              fontWeight: 700,
              color: INK,
              letterSpacing: -2,
            }}
          >
            VERSIONS
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 64, height: 4, background: RUST }} />
            <div style={{ fontSize: 30, color: INK_2 }}>
              music &amp; product placements · one listing primitive
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: PAPER_2,
              border: `1px solid ${INK_3}22`,
              borderRadius: 12,
              padding: "20px 28px",
            }}
          >
            <div style={{ fontSize: 24, color: INK }}>supply</div>
            <Arrow />
            <div style={{ fontSize: 24, color: INK }}>ethos match</div>
            <Arrow />
            <div style={{ fontSize: 24, color: INK }}>use / buy slot</div>
            <Arrow />
            <div style={{ fontSize: 24, color: RUST }}>
              settle 60/30/10 on Arc
            </div>
          </div>
          <div style={{ fontSize: 20, color: INK_3 }}>
            verified reach only · tracked usage · settled in USDC
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function Arrow() {
  return (
    <div style={{ fontSize: 24, color: INK_3 }}>&rarr;</div>
  );
}
