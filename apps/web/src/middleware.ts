import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { UserRole } from "@/shared/schema";
import {
  supportedLocales,
  defaultLocale,
  type SupportedLocale,
} from "@shared/i18n";

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

  // Extract path components
  const pathParts = pathname.split("/");
  // Ensure currentLocale is always a string
  const currentLocale = pathParts[1] ?? "en";

  // Get pathname without locale prefix for route checks
  const pathnameWithoutLocale = "/" + pathParts.slice(2).join("/");

  // Check if the path is a protected route (using path without locale)
  const isProtectedRoute =
    pathnameWithoutLocale.startsWith("/dashboard") ||
    pathnameWithoutLocale.startsWith("/api/dashboard") ||
    pathnameWithoutLocale.startsWith("/api/events") ||
    pathnameWithoutLocale.startsWith("/api/logs");

  // Check if the path is an admin route
  const isAdminRoute =
    pathnameWithoutLocale.startsWith("/dashboard/admin") ||
    pathnameWithoutLocale.startsWith("/api/admin");

  // Check if the path is an auth route
  const isAuthRoute = pathnameWithoutLocale.startsWith("/api/auth");

  // Public routes (no auth required)
  if (!isProtectedRoute && !isAuthRoute) {
    return NextResponse.next();
  }

  // Auth routes are handled by NextAuth.js
  if (isAuthRoute) {
    return NextResponse.next();
  }

  // For protected routes, check authentication
  const token = await getToken({ req: request });

  // If no token and accessing a protected route, redirect to login with locale
  if (!token && isProtectedRoute) {
    return NextResponse.redirect(
      new URL(`/${currentLocale}/auth/signin`, request.url),
    );
  }

  // If user is accessing an admin route, check role
  if (isAdminRoute && token) {
    // Check user role
    if (token.role !== UserRole.ADMIN) {
      // Redirect to dashboard if not admin, preserving locale
      return NextResponse.redirect(
        new URL(`/${currentLocale}/dashboard`, request.url),
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
