import { type NextRequest, NextResponse } from "next/server";
import { OAuthFlow } from "@/lib/oauth/OAuthFlow";
import { oauthCallbackParamsSchema } from "@/lib/oauth/types";
import {
  GoogleOAuthProvider,
  MicrosoftOAuthProvider,
  SlackOAuthProvider,
} from "@/lib/oauth/providers";
import { db } from "@/server/db";
import { oauthStates } from "@/shared/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse callback parameters
    const params = oauthCallbackParamsSchema.parse({
      code: searchParams.get("code"),
      state: searchParams.get("state"),
      error: searchParams.get("error"),
      errorDescription: searchParams.get("error_description"),
    });

    // Get state record to determine provider
    const stateRecord = await db
      .select()
      .from(oauthStates)
      .where(eq(oauthStates.state, params.state))
      .limit(1);

    const state = stateRecord[0];
    if (!state) {
      return NextResponse.redirect(
        new URL("/dashboard/settings?error=invalid_state", request.url),
      );
    }

    const { providerId } = state;

    // Get OAuth configuration
    const clientId = process.env[`OAUTH_${providerId.toUpperCase()}_CLIENT_ID`];
    const clientSecret =
      process.env[`OAUTH_${providerId.toUpperCase()}_CLIENT_SECRET`];

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(
        new URL("/dashboard/settings?error=oauth_not_configured", request.url),
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
          scope: "openid email profile",
        });
        break;

      case "microsoft":
        const tenantId = process.env.OAUTH_MICROSOFT_TENANT_ID;
        provider = new MicrosoftOAuthProvider({
          clientId,
          clientSecret,
          redirectUri,
          scope: "offline_access User.Read",
          ...(tenantId && { tenantId }),
        });
        break;

      case "slack":
        provider = new SlackOAuthProvider({
          clientId,
          clientSecret,
          redirectUri,
          scope: "channels:read,chat:write",
        });
        break;

      default:
        return NextResponse.redirect(
          new URL("/dashboard/settings?error=invalid_provider", request.url),
        );
    }

    // Handle callback
    const flow = new OAuthFlow(provider);

    try {
      await flow.handleCallback(params);

      // Redirect to success page
      return NextResponse.redirect(
        new URL("/dashboard/settings?oauth=success", request.url),
      );
    } catch (error) {
      console.error("OAuth callback error:", error);

      // Redirect to error page
      return NextResponse.redirect(
        new URL(
          `/dashboard/settings?error=oauth_failed&details=${encodeURIComponent(error instanceof Error ? error.message : "Unknown error")}`,
          request.url,
        ),
      );
    }
  } catch (error) {
    console.error("OAuth callback error:", error);

    return NextResponse.redirect(
      new URL("/dashboard/settings?error=oauth_callback_failed", request.url),
    );
  }
}
