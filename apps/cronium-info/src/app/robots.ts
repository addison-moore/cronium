import type { MetadataRoute } from "next";
import { SITE_URL, absoluteUrl } from "@/lib/site";

/**
 * Served at /robots.txt. Replaces the old static public/robots.txt (a static
 * file in public/ would shadow this route). The Sitemap directive is the main
 * addition — it's how crawlers find the sitemap without manual submission.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Nothing user-facing lives under /api; keep it out of the index.
        disallow: ["/api/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
