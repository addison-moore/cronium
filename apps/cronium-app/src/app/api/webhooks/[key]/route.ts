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

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, X-Webhook-Signature, X-Webhook-Timestamp",
      "Access-Control-Max-Age": "86400",
    },
  });
}
