import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  // Redirect to the Express endpoint with the query parameters
  const url = new URL("/api/callback", request.url);
  url.search = request.nextUrl.search;

  return NextResponse.redirect(url);
}
