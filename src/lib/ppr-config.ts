/**
 * Partial Prerendering (PPR) and ISR Configuration
 * Centralized configuration for caching and revalidation
 */

// Revalidation times in seconds
export const REVALIDATION_TIMES = {
  // Documentation pages - revalidate every hour
  DOCS: 3600, // 1 hour

  // Landing page - revalidate every 6 hours
  LANDING: 21600, // 6 hours

  // API documentation - revalidate every 30 minutes
  API_DOCS: 1800, // 30 minutes

  // Feature pages - revalidate daily
  FEATURES: 86400, // 24 hours

  // Default fallback
  DEFAULT: 3600, // 1 hour
} as const;

// Cache control headers for different page types
export const CACHE_HEADERS = {
  // Static assets (images, fonts, etc.)
  STATIC: {
    "Cache-Control": "public, max-age=31536000, immutable",
  },

  // PPR pages with ISR
  PPR_PAGE: {
    "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
  },

  // Dynamic pages (no cache)
  DYNAMIC: {
    "Cache-Control": "private, no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  },

  // API routes
  API: {
    "Cache-Control": "private, no-cache, no-store, must-revalidate",
  },
} as const;

// Page-specific PPR configuration
export const PPR_CONFIG = {
  // Documentation pages
  docs: {
    ppr: true,
    revalidate: REVALIDATION_TIMES.DOCS,
    dynamic: "force-static",
  },

  // Landing page
  landing: {
    ppr: true,
    revalidate: REVALIDATION_TIMES.LANDING,
    dynamic: "force-static",
  },

  // API documentation
  apiDocs: {
    ppr: true,
    revalidate: REVALIDATION_TIMES.API_DOCS,
    dynamic: "force-static",
  },
} as const;

// Helper function to get revalidation time for a route
export function getRevalidationTime(route: string): number {
  if (route.includes("/docs/api")) {
    return REVALIDATION_TIMES.API_DOCS;
  }
  if (route.includes("/docs")) {
    return REVALIDATION_TIMES.DOCS;
  }
  if (route === "/" || /^\/[a-z]{2}$/.exec(route)) {
    return REVALIDATION_TIMES.LANDING;
  }
  return REVALIDATION_TIMES.DEFAULT;
}

// Cache tags for on-demand revalidation
export const CACHE_TAGS = {
  DOCS: "docs",
  LANDING: "landing",
  API_DOCS: "api-docs",
  ALL_STATIC: "static-content",
} as const;

// Helper to generate cache tags for a page
export function getCacheTags(route: string): string[] {
  const tags: string[] = [CACHE_TAGS.ALL_STATIC];

  if (route.includes("/docs/api")) {
    tags.push(CACHE_TAGS.API_DOCS, CACHE_TAGS.DOCS);
  } else if (route.includes("/docs")) {
    tags.push(CACHE_TAGS.DOCS);
  } else if (route === "/" || /^\/[a-z]{2}$/.exec(route)) {
    tags.push(CACHE_TAGS.LANDING);
  }

  return tags;
}
