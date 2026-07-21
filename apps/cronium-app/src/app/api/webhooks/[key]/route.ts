import { type NextRequest, NextResponse } from "next/server";
import { WebhookRouter } from "@/lib/webhooks";

const webhookRouter = WebhookRouter.getInstance();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await params;

    if (!key) {
      return NextResponse.json(
        { error: "Webhook key is required" },
        { status: 400 },
      );
    }

    return await webhookRouter.handleRequest(key, request);
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Support other methods for webhook testing
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;

  // Generate webhook documentation
  const docs = webhookRouter.generateDocumentation(key);

  return NextResponse.json({
    message: "This is a webhook endpoint. Please use POST method to send data.",
    documentation: docs,
  });
}

// Webhooks are server-to-server (HMAC-signed POSTs from backends, not
// browsers), so no cross-origin access is granted. The previous wildcard
// `Access-Control-Allow-Origin: *` was unnecessary (audit-2 L5); advertise the
// allowed methods without opening CORS to any origin.
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "POST, GET, OPTIONS",
    },
  });
}
