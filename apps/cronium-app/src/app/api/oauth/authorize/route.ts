import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { OAuthFlow } from "@/lib/oauth/OAuthFlow";
import { createProviderFromEnv } from "@/lib/oauth/providers";
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

    const body = (await request.json()) as unknown;
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

    // Create provider from OAUTH_<PROVIDER>_CLIENT_ID/SECRET env config
    const provider = createProviderFromEnv(providerId, scope);
    if (!provider) {
      return NextResponse.json(
        { error: `OAuth not configured for ${providerId}` },
        { status: 400 },
      );
    }

    // Redirect URI must match the one registered with the provider
    const baseUrl = process.env.AUTH_URL ?? "http://localhost:5001";
    const redirectUri = `${baseUrl}/api/oauth/callback`;

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
        { error: "Invalid request", details: error.issues },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "Failed to initiate OAuth flow" },
      { status: 500 },
    );
  }
}
