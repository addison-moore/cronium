/**
 * McpConnectManager — the Settings → Connect AI onboarding card.
 *
 * Pins the component's observable contract:
 *   - shows this instance's /api/mcp endpoint (derived from location.origin)
 *   - mints an MCP-scoped token: exactly scopes ["mcp"], 90-day expiry
 *   - the minted token is shown once and substituted into the setup snippets
 *     (placeholder "<your-token>" until then)
 *   - "Manage existing tokens" deep-links to the api-tokens tab via URL hash
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type MutationOpts = {
  onSuccess?: (data: { displayToken: string }) => void;
  onError?: (error: { message: string }) => void;
};

const mutateMock = jest.fn();
let capturedOpts: MutationOpts = {};

jest.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      createApiToken: {
        useMutation: (opts: MutationOpts) => {
          capturedOpts = opts;
          return { mutate: mutateMock, isPending: false };
        },
      },
    },
  },
}));

import McpConnectManager from "@/components/dashboard/McpConnectManager";

describe("McpConnectManager", () => {
  beforeEach(() => {
    mutateMock.mockClear();
    capturedOpts = {};
    window.location.hash = "";
  });

  it("shows this instance's MCP endpoint URL", () => {
    render(<McpConnectManager />);
    // jsdom origin is http://localhost
    expect(
      screen.getByDisplayValue("http://localhost/api/mcp"),
    ).toBeInTheDocument();
  });

  it("mints a token with exactly the mcp scope and 90-day expiry", async () => {
    const user = userEvent.setup();
    render(<McpConnectManager />);

    await user.click(screen.getByRole("button", { name: /create mcp token/i }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock).toHaveBeenCalledWith({
      name: "AI connector",
      scopes: ["mcp"],
      expiresInDays: 90,
    });
  });

  it("uses a custom token name when provided", async () => {
    const user = userEvent.setup();
    render(<McpConnectManager />);

    const nameInput = screen.getByDisplayValue("AI connector");
    await user.clear(nameInput);
    await user.type(nameInput, "My laptop");
    await user.click(screen.getByRole("button", { name: /create mcp token/i }));

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My laptop", scopes: ["mcp"] }),
    );
  });

  it("substitutes the minted token into snippets (placeholder until then)", async () => {
    const user = userEvent.setup();
    render(<McpConnectManager />);

    // Before minting: the Claude Code snippet carries the placeholder.
    await user.click(screen.getByRole("tab", { name: /claude code/i }));
    expect(
      screen.getByText(/CRONIUM_API_TOKEN=<your-token>/),
    ).toBeInTheDocument();

    // Mint → onSuccess with the one-time token.
    await user.click(screen.getByRole("button", { name: /create mcp token/i }));
    act(() => {
      capturedOpts.onSuccess?.({ displayToken: "crn_test_token_123" });
    });

    // One-time surface + snippet substitution.
    expect(
      await screen.findByDisplayValue("crn_test_token_123"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/CRONIUM_API_TOKEN=crn_test_token_123/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/CRONIUM_API_TOKEN=<your-token>/),
    ).not.toBeInTheDocument();
  });

  it("deep-links to the api-tokens tab for token management", async () => {
    const user = userEvent.setup();
    render(<McpConnectManager />);

    await user.click(
      screen.getByRole("button", { name: /manage existing tokens/i }),
    );
    expect(window.location.hash).toBe("#api-tokens");
  });
});
