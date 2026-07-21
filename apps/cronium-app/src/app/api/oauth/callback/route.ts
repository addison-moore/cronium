import { type NextRequest, NextResponse } from "next/server";
import { OAuthFlow } from "@/lib/oauth/OAuthFlow";
import { oauthCallbackParamsSchema } from "@/lib/oauth/types";
import {
  createProviderFromEnv,
  type OAuthProviderId,
} from "@/lib/oauth/providers";
import { db } from "@/server/db";
import { oauthStates } from "@/shared/schema";
import { eq } from "drizzle-orm";

// Tool credential forms (where the Connect flow starts) live on the Tools page
const RETURN_PATH = "/dashboard/tools";

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
        new URL(`${RETURN_PATH}?error=invalid_state`, request.url),
      );
    }

    const providerId = state.providerId as OAuthProviderId;
    if (!["google", "microsoft", "slack"].includes(providerId)) {
      return NextResponse.redirect(
        new URL(`${RETURN_PATH}?error=invalid_provider`, request.url),
      );
    }

    // Scope is inert at token-exchange time; the shared factory supplies
    // the provider's default
    const provider = createProviderFromEnv(providerId);
    if (!provider) {
      return NextResponse.redirect(
        new URL(`${RETURN_PATH}?error=oauth_not_configured`, request.url),
      );
    }

    // Handle callback, binding to the nonce set in the initiating browser.
    const flow = new OAuthFlow(provider);
    const browserNonce = request.cookies.get("cronium-oauth-nonce")?.value;

    try {
      await flow.handleCallback(params, browserNonce);

      // Redirect to success page and clear the one-time binding cookie.
      const success = NextResponse.redirect(
        new URL(`${RETURN_PATH}?oauth=success`, request.url),
      );
      success.cookies.delete("cronium-oauth-nonce");
      return success;
    } catch (error) {
      console.error("OAuth callback error:", error);

      // Redirect to error page
      return NextResponse.redirect(
        new URL(
          `${RETURN_PATH}?error=oauth_failed&details=${encodeURIComponent(error instanceof Error ? error.message : "Unknown error")}`,
          request.url,
        ),
      );
    }
  } catch (error) {
    console.error("OAuth callback error:", error);

    return NextResponse.redirect(
      new URL(`${RETURN_PATH}?error=oauth_callback_failed`, request.url),
    );
  }
}
