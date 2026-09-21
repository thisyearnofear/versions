// MODULAR: sitemap = the static public doors plus every live listing's
// attribution page (the URLs our credits point to in the wild). The DB read
// is guarded so a fresh deploy without tables can't 500 the route — it
// falls back to the static doors only.

import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { listings } from "@/lib/schema";
import { APP_URL } from "@/lib/attribution";

// Listings accrue at runtime, so the sitemap must be generated per
// request (well, per crawl) — a build-time snapshot would silently
// freeze the catalog at deploy time.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticDoors: MetadataRoute.Sitemap = [
    { url: APP_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${APP_URL}/discover`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${APP_URL}/submit`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${APP_URL}/channels`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${APP_URL}/legal/agreement`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
  ];

  try {
    const rows = await db
      .select({ id: listings.id, updatedAt: listings.updatedAt })
      .from(listings)
      .where(eq(listings.status, "active"));
    return [
      ...staticDoors,
      ...rows.map((r) => ({
        url: `${APP_URL}/listings/${r.id}`,
        lastModified: r.updatedAt ?? now,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ];
  } catch {
    return staticDoors;
  }
}
