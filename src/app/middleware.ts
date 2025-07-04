import { type NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Allow forwarding cookies to our Express authentication server
  const cookie = request.headers.get("cookie");
  if (cookie) {
    response.headers.set("cookie", cookie);
  }

  return response;
}

export const config = {
  matcher: [
    // Match all API routes
    "/api/:path*",
  ],
};
