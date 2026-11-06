/**
 * Disconnect has to say when it fails. react-query is real, and errors are real
 * TRPCClientErrors.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import type { ToolWithParsedCredentials } from "@/tools/types/tool-plugin";

const mockToast = jest.fn();
const mockRevoke = jest.fn();
const mockRefetch = jest.fn();

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/tools/ToolHealthIndicator", () => ({
  ToolHealthBadge: () => null,
}));

jest.mock("@/lib/trpc", () => {
  const { useMutation } = jest.requireActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  return {
    trpc: {
      tools: {
        checkOAuthStatus: {
          useQuery: () => ({
            data: { configured: true, hasTokens: true },
            refetch: mockRefetch,
          }),
        },
        revokeOAuthTokens: {
          useMutation: (options?: object) =>
            useMutation({
              mutationFn: (input: unknown): Promise<unknown> =>
                mockRevoke(input) as Promise<unknown>,
              ...options,
            }),
        },
      },
    },
  };
});

import { GoogleSheetsPlugin } from "../google-sheets-plugin";

const CredentialDisplay = GoogleSheetsPlugin.CredentialDisplay;

const tool: ToolWithParsedCredentials = {
  id: 4,
  userId: "me",
  name: "Sheets",
  type: "GOOGLE-SHEETS",
  credentials: { scope: "https://www.googleapis.com/auth/spreadsheets" },
  isActive: true,
  encrypted: true,
  encryptionMetadata: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function renderDisplay() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CredentialDisplay
        tools={[tool]}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const disconnect = () => screen.getByRole("button", { name: "Disconnect" });

function refusal(message: string): TRPCClientError<never> {
  return TRPCClientError.from({
    error: {
      message,
      code: -32603,
      data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, zodError: null },
    },
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("Disconnect", () => {
  it("shows the server's reason, once, and rereads the status", async () => {
    mockRevoke.mockRejectedValue(refusal("Failed to revoke OAuth tokens"));
    const user = renderDisplay();

    await user.click(disconnect());

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith({
      title: "Disconnect Failed",
      description: "Failed to revoke OAuth tokens",
      variant: "destructive",
    });
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
    await waitFor(() => expect(disconnect()).toBeEnabled());
  });

  it("still says something when the error has no message", async () => {
    mockRevoke.mockRejectedValue(refusal(""));
    const user = renderDisplay();

    await user.click(disconnect());

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Disconnect Failed",
        description: "Failed to disconnect the Google account",
        variant: "destructive",
      }),
    );
  });

  it("says nothing when it works, because the page changes", async () => {
    mockRevoke.mockResolvedValue({ success: true });
    const user = renderDisplay();

    await user.click(disconnect());

    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
    expect(mockToast).not.toHaveBeenCalled();
  });
});
