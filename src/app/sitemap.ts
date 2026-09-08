import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/** The three public pages. /desk is deliberately absent — see robots.ts. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/docs`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/positions`, changeFrequency: "hourly", priority: 0.6 },
  ];
}
