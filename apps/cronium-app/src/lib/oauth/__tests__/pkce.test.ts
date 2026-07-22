/**
 * @jest-environment node
 *
 * HI-06 regression: outbound OAuth authorization URLs must carry a PKCE S256
 * challenge so an intercepted authorization code cannot be exchanged without
 * the verifier.
 */
import { GoogleOAuthProvider } from "../providers/google";
import { MicrosoftOAuthProvider } from "../providers/microsoft";
import { SlackOAuthProvider } from "../providers/slack";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://app.example/api/oauth/callback",
  scope: "openid email",
};

const providers = [
  ["google", new GoogleOAuthProvider(config)],
  ["microsoft", new MicrosoftOAuthProvider(config)],
  ["slack", new SlackOAuthProvider(config)],
] as const;

describe("OAuth PKCE challenge (HI-06)", () => {
  it.each(providers)(
    "%s includes code_challenge + S256 when a challenge is provided",
    (_name, provider) => {
      const url = provider.getAuthorizationUrl(
        "state-123",
        undefined,
        "CHALLENGE-VALUE",
      );
      const params = new URL(url).searchParams;
      expect(params.get("code_challenge")).toBe("CHALLENGE-VALUE");
      expect(params.get("code_challenge_method")).toBe("S256");
      expect(params.get("state")).toBe("state-123");
    },
  );

  it.each(providers)(
    "%s omits the challenge params when none is provided",
    (_name, provider) => {
      const url = provider.getAuthorizationUrl("state-123");
      const params = new URL(url).searchParams;
      expect(params.get("code_challenge")).toBeNull();
    },
  );
});
