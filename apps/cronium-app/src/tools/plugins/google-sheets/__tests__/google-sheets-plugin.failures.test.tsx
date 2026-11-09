/**
 * Connect and Disconnect have to say when they fail. react-query is real, and errors
 * are real TRPCClientErrors.
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
const mockHealthCheck = jest.fn();
let mockHasTokens = true;

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  useToast: () => ({ toast: mockToast }),
}));

// The real badge tests the connection when it mounts, and only then.
jest.mock("@/tools/ToolHealthIndicator", () => ({
  ToolHealthBadge: () => {
    const { useEffect } = jest.requireActual<typeof import("react")>("react");
    useEffect(() => {
      mockHealthCheck();
    }, []);
    return null;
  },
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
            data: { configured: true, hasTokens: mockHasTokens },
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

function display() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <CredentialDisplay
        tools={[tool]}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />
    </QueryClientProvider>
  );
}

function renderDisplay() {
  render(display());
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
  mockHasTokens = true;
});

describe("Connect", () => {
  const connect = () =>
    screen.getByRole("button", { name: "Connect Google Account" });
  const realFetch = global.fetch;

  beforeEach(() => {
    mockHasTokens = false;
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  function authorizeAnswers(status: number, body: string) {
    global.fetch = jest.fn().mockResolvedValue(
      // jsdom has no Response, and the handler only reads these.
      {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(JSON.parse(body) as unknown),
      },
    );
  }

  it("asks to authorize this tool with the Google provider", async () => {
    authorizeAnswers(400, JSON.stringify({ error: "refused" }));
    const user = renderDisplay();

    await user.click(connect());

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    const [url, init] = jest.mocked(global.fetch).mock.calls[0]!;
    expect(url).toBe("/api/oauth/authorize");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      toolId: 4,
      providerId: "google",
    });
  });

  it("gives the route's reason when it refuses, and can be pressed again", async () => {
    authorizeAnswers(
      400,
      JSON.stringify({ error: "OAuth not configured for google" }),
    );
    const user = renderDisplay();

    await user.click(connect());

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith({
      title: "Connect Failed",
      description: "OAuth not configured for google",
      variant: "destructive",
    });
    expect(connect()).toBeEnabled();
  });

  it("says so when the answer has no way onward", async () => {
    authorizeAnswers(200, JSON.stringify({}));
    const user = renderDisplay();

    await user.click(connect());

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Connect Failed",
        description: "Failed to start Google authorization",
        variant: "destructive",
      }),
    );
  });

  it("says so when the route can't be reached", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const user = renderDisplay();

    await user.click(connect());

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Connect Failed",
        description: "Failed to start Google authorization",
        variant: "destructive",
      }),
    );
    expect(connect()).toBeEnabled();
  });

  it("says so when a proxy answers with something that isn't JSON", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    });
    const user = renderDisplay();

    await user.click(connect());

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Connect Failed",
        description: "Failed to start Google authorization",
        variant: "destructive",
      }),
    );
  });
});

describe("the health badge", () => {
  it("tests the connection once when the page shows it", () => {
    renderDisplay();

    expect(mockHealthCheck).toHaveBeenCalledTimes(1);
  });

  it("tests again when the connection changes, so it can't contradict it", () => {
    const { rerender } = render(display());
    expect(mockHealthCheck).toHaveBeenCalledTimes(1);

    mockHasTokens = false;
    rerender(display());

    expect(mockHealthCheck).toHaveBeenCalledTimes(2);
  });
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
