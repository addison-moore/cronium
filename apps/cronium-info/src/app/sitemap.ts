import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

/**
 * Served at /sitemap.xml. Referenced from robots.ts so crawlers discover it.
 * Keep in sync when adding routes under app/.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const routes: Array<{
    path: string;
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  }> = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" },

    // Docs hub + the pages a new user hits first
    { path: "/docs", priority: 0.9, changeFrequency: "weekly" },
    { path: "/docs/quick-start", priority: 0.9, changeFrequency: "monthly" },
    { path: "/docs/self-hosting", priority: 0.9, changeFrequency: "monthly" },
    { path: "/docs/features", priority: 0.8, changeFrequency: "monthly" },

    // Feature/reference docs
    { path: "/docs/tools", priority: 0.8, changeFrequency: "monthly" },
    {
      path: "/docs/runtime-helpers",
      priority: 0.7,
      changeFrequency: "monthly",
    },
    { path: "/docs/unified-io", priority: 0.7, changeFrequency: "monthly" },
    { path: "/docs/templates", priority: 0.6, changeFrequency: "monthly" },
    { path: "/docs/api", priority: 0.8, changeFrequency: "monthly" },

    // How-to guides
    { path: "/docs/how-to", priority: 0.7, changeFrequency: "monthly" },
    {
      path: "/docs/how-to/first-event",
      priority: 0.7,
      changeFrequency: "monthly",
    },
    {
      path: "/docs/how-to/connect-server",
      priority: 0.7,
      changeFrequency: "monthly",
    },
    {
      path: "/docs/how-to/build-workflow",
      priority: 0.7,
      changeFrequency: "monthly",
    },
  ];

  return routes.map(({ path, priority, changeFrequency }) => ({
    url: absoluteUrl(path),
    lastModified,
    changeFrequency,
    priority,
  }));
}
