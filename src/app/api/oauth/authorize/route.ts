import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { OAuthFlow } from "@/lib/oauth/OAuthFlow";
import {
  GoogleOAuthProvider,
  MicrosoftOAuthProvider,
  SlackOAuthProvider,
} from "@/lib/oauth/providers";
import { db } from "@/server/db";
import { toolCredentials } from "@/shared/schema";
import { eq } from "drizzle-orm";

// Request schema
const authorizeSchema = z.object({
  toolId: z.number(),
  providerId: z.enum(["google", "microsoft", "slack"]),
  scope: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { toolId, providerId, scope } = authorizeSchema.parse(body);

    // Get tool credentials
    const tool = await db
      .select()
      .from(toolCredentials)
      .where(eq(toolCredentials.id, toolId))
      .limit(1);

    const toolRecord = tool[0];
    if (!toolRecord || toolRecord.userId !== session.user.id) {
      return NextResponse.json(
        { error: "Tool not found or unauthorized" },
        { status: 404 },
      );
    }

    // Get OAuth configuration from environment
    const clientId = process.env[`OAUTH_${providerId.toUpperCase()}_CLIENT_ID`];
    const clientSecret =
      process.env[`OAUTH_${providerId.toUpperCase()}_CLIENT_SECRET`];

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: `OAuth not configured for ${providerId}` },
        { status: 400 },
      );
    }

    // Create redirect URI
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:5001";
    const redirectUri = `${baseUrl}/api/oauth/callback`;

    // Create provider
    let provider;
    switch (providerId) {
      case "google":
        provider = new GoogleOAuthProvider({
          clientId,
          clientSecret,
          redirectUri,
          scope: scope ?? "openid email profile",
        });
        break;

      case "microsoft":
        const tenantId = process.env.OAUTH_MICROSOFT_TENANT_ID;
        provider = new MicrosoftOAuthProvider({
          clientId,
          clientSecret,
          redirectUri,
          scope: scope ?? "offline_access User.Read",
          ...(tenantId && { tenantId }),
        });
        break;

      case "slack":
        provider = new SlackOAuthProvider({
          clientId,
          clientSecret,
          redirectUri,
          scope: scope ?? "channels:read,chat:write",
        });
        break;

      default:
        return NextResponse.json(
          { error: "Invalid provider" },
          { status: 400 },
        );
    }

    // Initialize OAuth flow
    const flow = new OAuthFlow(provider);
    const authUrl = await flow.initiate(
      session.user.id,
      toolId,
      redirectUri,
      scope,
    );

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error("OAuth authorize error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.errors },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "Failed to initiate OAuth flow" },
      { status: 500 },
    );
  }
}
