import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  supportedLocales,
  defaultLocale,
  type SupportedLocale,
} from "@/shared/i18n";

// Simplified function to get the preferred locale from the request
function getLocale(request: NextRequest): string {
  // Get Accept-Language header
  const acceptLanguage = request.headers.get("accept-language") ?? "";

  // Parse the Accept-Language header
  const userLanguages = acceptLanguage.split(",").map((lang) => {
    const parts = lang.split(";");
    return (parts[0] ?? lang).trim();
  });

  // Find the first supported locale that matches the user's language
  for (const lang of userLanguages) {
    const parts = lang.split("-");
    const languageCode = parts.length > 0 ? parts[0] : lang; // Extract just the language code (e.g., 'en' from 'en-US')

    // Check if the language code is one of our supported locales
    if (
      languageCode &&
      supportedLocales.includes(languageCode as SupportedLocale)
    ) {
      return languageCode as SupportedLocale;
    }
  }

  // Default to the default locale if no match is found
  return defaultLocale;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip internationalization for API routes, public files, assets, etc.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/assets") ||
    pathname.includes("/favicon.ico") ||
    pathname.includes("/manifest.json") ||
    pathname.includes("/robots.txt") ||
    pathname.includes("/sitemap.xml")
  ) {
    return NextResponse.next();
  }

  // Check if the URL already has a locale prefix
  const pathnameHasLocale = supportedLocales.some(
    (locale: SupportedLocale) =>
      pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`,
  );

  // If URL doesn't have locale, redirect to add locale prefix
  if (!pathnameHasLocale) {
    // Special handling for root path to avoid redirect loops
    if (pathname === "/") {
      const locale = getLocale(request);
      const newUrl = new URL(`/${locale}`, request.url);
      newUrl.search = request.nextUrl.search;
      return NextResponse.redirect(newUrl);
    } else {
      const locale = getLocale(request);
      const newUrl = new URL(`/${locale}${pathname}`, request.url);
      newUrl.search = request.nextUrl.search;
      return NextResponse.redirect(newUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static assets, public assets
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
