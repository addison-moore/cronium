/**
 * Central site configuration.
 *
 * Every absolute URL used for SEO (canonical links, sitemap entries,
 * OpenGraph/Twitter images, JSON-LD) derives from SITE_URL. Override it per
 * environment with NEXT_PUBLIC_SITE_URL so preview deploys don't advertise
 * production canonicals.
 */

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://cronium.app"
).replace(/\/$/, "");

export const GITHUB_URL = "https://github.com/addison-moore/cronium";

/**
 * Google Analytics 4 measurement ID. Public by design — it ships in the page.
 * Override per environment with NEXT_PUBLIC_GA_ID; set it to an empty string
 * to disable analytics entirely for a given deploy.
 */
export const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_ID ?? "G-K5J8YTQYPN";

export const SITE_NAME = "Cronium";

/** Used as the homepage <title> and the OpenGraph title. */
export const SITE_TITLE =
  "Cronium — Self-Hosted Automation & Job Scheduling Platform";

/**
 * ~155 chars: what shows under the title in search results. Leads with what it
 * is, who it's for, and the differentiator (self-hosted / open source).
 */
export const SITE_DESCRIPTION =
  "Cronium is an open-source, self-hosted automation platform. Schedule Python, Node.js, and Bash scripts, build multi-step workflows, and run them on your own servers.";

export const SITE_TAGLINE = "Self-hosted automation you actually control.";

/** Keywords are a weak ranking signal, but harmless and useful for context. */
export const SITE_KEYWORDS = [
  "cronium",
  "cronium automation",
  "self-hosted automation",
  "open source automation platform",
  "job scheduler",
  "cron alternative",
  "workflow automation",
  "task scheduler",
  "script scheduling",
  "self-hosted cron",
  "devops automation",
  "docker automation",
];

export const absoluteUrl = (path = "/") =>
  `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
