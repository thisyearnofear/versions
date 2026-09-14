import { NextRequest, NextResponse } from "next/server";
import { services, requestIdFor } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const slot = await services().slots.getByTrackingCode(code);
  if (!slot) {
    return new NextResponse("Not found", { status: 404, headers: { "x-request-id": requestIdFor(req) } });
  }
  // Public proof: every tracking link resolves to its listing.
  // The redirect is the attribution proof; the impression is counted when the
  // channel reports delivery (POST /api/v1/usage), not on this hit.
  const listing = await services().listings.get(slot.listing_id);
  const url = listing?.attribution_url ?? `/?t=${encodeURIComponent(code)}`;
  // Use 302 so the tracking code stays in access logs without being cached.
  return NextResponse.redirect(url, { status: 302, headers: { "x-request-id": requestIdFor(req) } });
}
