import { type NextRequest, NextResponse } from "next/server";
import { BROWSER_NONCE_COOKIE, OAuthFlow } from "@/lib/oauth/OAuthFlow";
import { oauthCallbackParamsSchema } from "@/lib/oauth/types";
import {
  createProviderFromEnv,
  type OAuthProviderId,
} from "@/lib/oauth/providers";
import { db } from "@/server/db";
import { oauthStates, toolCredentials } from "@/shared/schema";
import { eq } from "drizzle-orm";
import {
  QUERY_FAILED_MESSAGE,
  failureWithStack,
  isQueryFailure,
} from "@/lib/pg-errors";

// Tool credential forms (where the Connect flow starts) live on the Tools page
const RETURN_PATH = "/dashboard/tools";

/**
 * In characters, each of which can take 12 bytes once encoded. A proxy in front may only
 * hold 4 KB of response headers, nginx's default, and answers 502 for more than that.
 */
const MAX_DETAILS_LENGTH = 200;

/**
 * Back to the Tools page. The Location is relative so the browser stays at the address it
 * came here on, the one its session cookie belongs to. request.url won't do: Next builds
 * it from the address the server listens on, whatever Host or X-Forwarded-Host says,
 * which in the Docker image makes it http://0.0.0.0:3000.
 */
function backToTools(result: Record<string, string>): NextResponse {
  const query = Object.entries(result)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("&");
  return new NextResponse(null, {
    status: 307,
    headers: { Location: `${RETURN_PATH}?${query}` },
  });
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse callback parameters. get() gives null for an absent one, which the schema
    // refuses, and a redirect never has them all: it brings a code or an error.
    const params = oauthCallbackParamsSchema.parse({
      code: searchParams.get("code") ?? undefined,
      state: searchParams.get("state") ?? undefined,
      error: searchParams.get("error") ?? undefined,
      errorDescription: searchParams.get("error_description") ?? undefined,
    });

    // Get state record to determine provider, and the tool, so the page can open on it
    // and its Connect button
    const stateRecord = await db
      .select({
        providerId: oauthStates.providerId,
        toolType: toolCredentials.type,
      })
      .from(oauthStates)
      .innerJoin(toolCredentials, eq(toolCredentials.id, oauthStates.toolId))
      .where(eq(oauthStates.state, params.state))
      .limit(1);

    const state = stateRecord[0];
    if (!state) {
      return backToTools({ error: "invalid_state" });
    }

    const providerId = state.providerId as OAuthProviderId;
    if (!["google", "microsoft", "slack"].includes(providerId)) {
      return backToTools({ error: "invalid_provider", tool: state.toolType });
    }

    // Scope is inert at token-exchange time; the shared factory supplies
    // the provider's default
    const provider = createProviderFromEnv(providerId);
    if (!provider) {
      return backToTools({
        error: "oauth_not_configured",
        tool: state.toolType,
      });
    }

    // Handle callback, binding to the nonce set in the initiating browser.
    const flow = new OAuthFlow(provider);
    const browserNonce = request.cookies.get(BROWSER_NONCE_COOKIE.name)?.value;

    try {
      await flow.handleCallback(params, browserNonce);

      // Redirect to success page and clear the one-time binding cookie.
      const success = backToTools({ oauth: "success", tool: state.toolType });
      success.cookies.delete(BROWSER_NONCE_COOKIE);
      return success;
    } catch (error) {
      console.error("OAuth callback error:", failureWithStack(error));

      // This ends up in a URL, so in browser history and proxy logs, and a failed
      // query's message holds the tokens it was saving, even encrypted.
      const details = isQueryFailure(error)
        ? QUERY_FAILED_MESSAGE
        : error instanceof Error
          ? error.message
          : "Unknown error";

      // Redirect to error page. Whole characters, because encoding half of one throws.
      return backToTools({
        error: "oauth_failed",
        details: Array.from(details).slice(0, MAX_DETAILS_LENGTH).join(""),
        tool: state.toolType,
      });
    }
  } catch (error) {
    console.error("OAuth callback error:", failureWithStack(error));

    return backToTools({ error: "oauth_callback_failed" });
  }
}
