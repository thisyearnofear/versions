// MODULAR: per-listing Open Graph card. These pages are linked from
// attribution credits in public video descriptions, so the share card
// carries the listing name, supplier and tier. Reads via
// fetchListingById (in-process or box API) so a Netlify UI host does
// not need a DB pool. Missing rows render a neutral card instead of
// throwing — a broken image route would 404 the card and lose the share
// preview entirely.

import { ImageResponse } from "next/og";
import { fetchListingById } from "@/lib/server-marketplace";

export const alt = "VERSIONS listing — music & product placements";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#f4efe5";
const INK = "#1a1a1a";
const INK_2 = "#4a4a4a";
const INK_3 = "#8a8a8a";
const RUST = "#c84a1f";

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let row: {
    title: string;
    supplierName: string;
    kind: string;
    tier: string;
  } | null = null;
  try {
    const listing = await fetchListingById(id);
    if (listing) {
      row = {
        title: listing.title,
        supplierName: listing.supplier_name,
        kind: listing.kind,
        tier: listing.tier,
      };
    }
  } catch {
    row = null;
  }

  const kicker = row
    ? `${row.kind === "music" ? "Track" : "Placement"} · ${row.tier === "free" ? "free with attribution" : "paid sponsor slot"}`
    : "VERSIONS listing";
  const title = row?.title ?? "Listing";
  const supplier = row?.supplierName ?? "";

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
            {kicker}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: title.length > 42 ? 64 : 84,
              fontWeight: 700,
              color: INK,
              letterSpacing: -1,
              lineHeight: 1.1,
            }}
          >
            {title}
          </div>
          {supplier ? (
            <div style={{ fontSize: 34, color: INK_2 }}>{supplier}</div>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 64, height: 4, background: RUST }} />
          <div style={{ fontSize: 24, color: INK_3 }}>
            VERSIONS · tracked &amp; settled on Arc
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
