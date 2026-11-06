/**
 * Test Connection and Send Test Message have to say when they fail and hand the
 * buttons back. Both used mutateAsync with no catch, so a refusal was an unhandled
 * rejection, and they cleared the "testing" state only on success. A webhook that
 * refuses the test comes back as a result rather than an error, and that read
 * "Test Successful".
 *
 * react-query is real, and errors are real TRPCClientErrors. Button keeps what its
 * handler returned, to catch a rejection nothing handles.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import type { ToolWithParsedCredentials } from "@/tools/types/tool-plugin";

const mockToast = jest.fn();
const mockServer = { testConnection: jest.fn(), send: jest.fn() };
const mockClickResults: unknown[] = [];

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  useToast: () => ({ toast: mockToast }),
  Button: ({
    onClick,
    children,
    disabled,
  }: {
    onClick?: () => unknown;
    children?: React.ReactNode;
    disabled?: boolean;
  }) => (
    <button
      disabled={disabled}
      onClick={() => {
        mockClickResults.push(onClick?.());
      }}
    >
      {children}
    </button>
  ),
}));

jest.mock("@/tools/ToolHealthIndicator", () => ({
  ToolHealthBadge: () => null,
}));
jest.mock("@/tools/components/TestConnectionButton", () => ({
  TestConnectionButton: () => null,
}));

jest.mock("@/lib/trpc", () => {
  const { useMutation } = jest.requireActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  const procedure = (name: keyof typeof mockServer) => ({
    useMutation: (options?: object) =>
      useMutation({
        mutationFn: (input: unknown): Promise<unknown> =>
          mockServer[name](input) as Promise<unknown>,
        ...options,
      }),
  });
  return {
    trpc: {
      tools: {
        slack: {
          testConnection: procedure("testConnection"),
          send: procedure("send"),
        },
      },
    },
  };
});

import { SlackPluginTrpc } from "../slack-plugin";

const CredentialDisplay = SlackPluginTrpc.CredentialDisplay;

const tool: ToolWithParsedCredentials = {
  id: 4,
  userId: "me",
  name: "Team Slack",
  type: "SLACK",
  credentials: { webhookUrl: "" },
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

function refusal(message: string): TRPCClientError<never> {
  return TRPCClientError.from({
    error: {
      message,
      code: -32600,
      data: { code: "BAD_REQUEST", httpStatus: 400, zodError: null },
    },
  });
}

const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  jest.resetAllMocks();
  mockClickResults.length = 0;
});

describe.each([
  [
    "Test Connection",
    "testConnection",
    "Test Failed",
    "Failed to test the connection",
  ],
  [
    "Send Test Message",
    "send",
    "Test Message Failed",
    "Failed to send the test message",
  ],
] as const)("%s", (name, procedure, title, fallback) => {
  it("shows the server's reason, once, when it's refused", async () => {
    mockServer[procedure].mockRejectedValue(refusal("Slack tool not found"));
    const user = renderDisplay();

    await user.click(button(name));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith({
      title,
      description: "Slack tool not found",
      variant: "destructive",
    });
  });

  it("still says something when the error has no message", async () => {
    mockServer[procedure].mockRejectedValue(refusal(""));
    const user = renderDisplay();

    await user.click(button(name));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title,
        description: fallback,
        variant: "destructive",
      }),
    );
  });

  it("hands the buttons back after a refusal", async () => {
    mockServer[procedure].mockRejectedValue(refusal("Slack tool not found"));
    const user = renderDisplay();

    await user.click(button(name));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    await waitFor(() => expect(button("Test Connection")).toBeEnabled());
    expect(button("Send Test Message")).toBeEnabled();
  });

  it("leaves no rejection for nothing to handle", async () => {
    mockServer[procedure].mockRejectedValue(refusal("Slack tool not found"));
    const user = renderDisplay();

    await user.click(button(name));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    await expect(Promise.all(mockClickResults)).resolves.toBeDefined();
  });
});

describe("a test the server ran", () => {
  it("doesn't say it worked when the webhook refused it", async () => {
    mockServer.testConnection.mockResolvedValue({
      success: false,
      message: "Slack webhook error: 404 no_service",
    });
    const user = renderDisplay();

    await user.click(button("Test Connection"));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith({
      title: "Test Failed",
      description: "Slack webhook error: 404 no_service",
      variant: "destructive",
    });
    await waitFor(() => expect(button("Test Connection")).toBeEnabled());
  });

  it("says it worked when it did", async () => {
    mockServer.testConnection.mockResolvedValue({
      success: true,
      message: "Slack connection test successful",
    });
    const user = renderDisplay();

    await user.click(button("Test Connection"));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith({
      title: "Test Successful",
      description: "Slack connection test successful",
    });
    await waitFor(() => expect(button("Test Connection")).toBeEnabled());
  });

  it("says a test message went out when it did", async () => {
    mockServer.send.mockResolvedValue({
      success: true,
      message: "Message sent to Slack successfully",
    });
    const user = renderDisplay();

    await user.click(button("Send Test Message"));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith({
      title: "Test Message Sent",
      description: "Message sent to Slack successfully",
    });
    await waitFor(() => expect(button("Send Test Message")).toBeEnabled());
  });
});
