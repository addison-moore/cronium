import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
} from "@/lib/security/security-headers";

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProduction = process.env.NODE_ENV === "production";
  // Strict nonce CSP is production-only; dev needs unsafe-eval/inline for HMR.
  const applyCsp = isProduction;
  const nonce = generateNonce();

  const isProtectedRoute =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/api/dashboard") ||
    pathname.startsWith("/api/events") ||
    pathname.startsWith("/api/logs");

  if (isProtectedRoute) {
    const sessionCookie =
      request.cookies.get("next-auth.session-token") ??
      request.cookies.get("__Secure-next-auth.session-token");

    if (!sessionCookie) {
      const redirect = NextResponse.redirect(
        new URL("/auth/signin", request.url),
      );
      applySecurityHeaders(redirect.headers, {
        nonce,
        isProduction,
        applyCsp,
      });
      return redirect;
    }
  }

  // Forward the nonce and CSP on the request so Next.js applies the nonce to
  // its own bundled scripts (official Next.js CSP integration pattern).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  if (applyCsp) {
    requestHeaders.set(
      "Content-Security-Policy",
      buildContentSecurityPolicy(nonce),
    );
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(response.headers, { nonce, isProduction, applyCsp });
  return response;
}

export const config = {
  matcher: [
    // Match all paths except static assets, public assets
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
