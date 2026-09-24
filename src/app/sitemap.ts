// MODULAR: sitemap = the static public doors plus every live listing's
// attribution page (the URLs our credits point to in the wild). Uses
// fetchActiveListingIds so a Netlify UI host can build the map via the
// box API without a local DB pool.

import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/attribution";
import { fetchActiveListingIds } from "@/lib/server-marketplace";

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
    const rows = await fetchActiveListingIds(500);
    return [
      ...staticDoors,
      ...rows.map((r) => ({
        url: `${APP_URL}/listings/${r.id}`,
        lastModified: r.updatedAt ? new Date(r.updatedAt) : now,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ];
  } catch {
    return staticDoors;
  }
}
