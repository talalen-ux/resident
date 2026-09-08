import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/**
 * The operator views under /desk read live vault state and are not for the
 * public. They are unlinked, but unlinked is not private — crawlers find routes
 * from sitemaps, referrers and certificate logs, so they are excluded here too.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/desk" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
