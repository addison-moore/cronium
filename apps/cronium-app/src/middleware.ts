import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Define constants locally to avoid imports in Edge runtime
const supportedLocales = ["en"] as const;
type SupportedLocale = (typeof supportedLocales)[number];
const defaultLocale: SupportedLocale = "en";

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
    const languageCode = parts.length > 0 ? parts[0] : lang;

    if (
      languageCode &&
      supportedLocales.includes(languageCode as SupportedLocale)
    ) {
      return languageCode as SupportedLocale;
    }
  }

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

  // Extract path components for auth checks
  const pathParts = pathname.split("/");
  const currentLocale = pathParts[1] ?? "en";
  const pathnameWithoutLocale = "/" + pathParts.slice(2).join("/");

  // Check if the path is a protected route
  const isProtectedRoute =
    pathnameWithoutLocale.startsWith("/dashboard") ||
    pathnameWithoutLocale.startsWith("/api/dashboard") ||
    pathnameWithoutLocale.startsWith("/api/events") ||
    pathnameWithoutLocale.startsWith("/api/logs");

  // For protected routes, we'll check the session cookie
  // This is a simple check - actual auth validation happens in the pages
  if (isProtectedRoute) {
    const sessionCookie =
      request.cookies.get("next-auth.session-token") ??
      request.cookies.get("__Secure-next-auth.session-token");

    if (!sessionCookie) {
      return NextResponse.redirect(
        new URL(`/${currentLocale}/auth/signin`, request.url),
      );
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
