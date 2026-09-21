// MODULAR: crawler rules. Public doors (landing, browse, submit, channels,
// the /listings/[id] attribution pages and /t/[code] tracking redirects) are
// meant to be indexed — attribution links live in public video descriptions.
// Session/workspace surfaces and the API are not.

import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/attribution";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/supervisor", "/agents", "/auth", "/admin"],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
