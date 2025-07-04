import { type NextRequest, NextResponse } from "next/server";

/**
 * Catch-all API route handler for invalid endpoints
 * Returns a consistent JSON error response instead of HTML 404
 */
export async function GET(request: NextRequest) {
  return createNotFoundResponse(request);
}

export async function POST(request: NextRequest) {
  return createNotFoundResponse(request);
}

export async function PUT(request: NextRequest) {
  return createNotFoundResponse(request);
}

export async function DELETE(request: NextRequest) {
  return createNotFoundResponse(request);
}

export async function PATCH(request: NextRequest) {
  return createNotFoundResponse(request);
}

function createNotFoundResponse(request: NextRequest) {
  const pathname = new URL(request.url).pathname;

  return NextResponse.json(
    {
      error: "Not Found",
      message: `API endpoint '${pathname}' does not exist`,
      statusCode: 404,
      timestamp: new Date().toISOString(),
    },
    {
      status: 404,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}
