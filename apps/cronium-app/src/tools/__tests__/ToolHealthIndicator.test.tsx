/**
 * The Tools page checks every tool it lists when it opens, through ToolHealthBadge, so a
 * user with many can reach the limit on connection checks. A refused check never reached
 * the tool, so it must not show the tool as broken. Other failures still do, as before.
 *
 * react-query is real, and errors are real TRPCClientErrors.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";

const mockToast = jest.fn();
const mockTestConnection = jest.fn();

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/lib/trpc", () => {
  const { useMutation } = jest.requireActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  return {
    trpc: {
      tools: {
        testConnection: {
          useMutation: (options?: object) =>
            useMutation({
              mutationFn: (input: unknown): Promise<unknown> =>
                mockTestConnection(input) as Promise<unknown>,
              ...options,
            }),
        },
      },
    },
  };
});

import { ToolHealthBadge, ToolHealthIndicator } from "../ToolHealthIndicator";

const LIMIT_MESSAGE =
  "You can check 60 connections to servers or tools a minute. Try again in 12 seconds.";

function failure(code: string, httpStatus: number, message: string) {
  return TRPCClientError.from({
    error: { message, code: -32600, data: { code, httpStatus } },
  });
}

function renderWithClient(element: React.ReactElement) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      {element}
    </QueryClientProvider>,
  );
}

const badge = () => document.querySelector("span[title]")!;

beforeEach(() => {
  jest.resetAllMocks();
});

describe("ToolHealthBadge", () => {
  it("shows the check under way, then the tool's answer", async () => {
    let answer!: (result: unknown) => void;
    mockTestConnection.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderWithClient(<ToolHealthBadge toolId={7} />);
    await waitFor(() => expect(badge()).toHaveAttribute("title", "Checking"));
    expect(mockTestConnection).toHaveBeenCalledWith({ id: 7 });

    answer({ success: true, message: "Connected" });
    await waitFor(() => expect(badge()).toHaveAttribute("title", "Healthy"));
  });

  it("leaves a tool unchecked, not broken, when the check is refused as too many", async () => {
    const onHealthChange = jest.fn();
    mockTestConnection.mockRejectedValue(
      failure("TOO_MANY_REQUESTS", 429, LIMIT_MESSAGE),
    );
    renderWithClient(
      <ToolHealthBadge toolId={7} onHealthChange={onHealthChange} />,
    );
    await waitFor(() =>
      expect(badge()).toHaveAttribute("title", `Not checked: ${LIMIT_MESSAGE}`),
    );
    expect(onHealthChange).not.toHaveBeenCalled();
  });

  it.each([
    ["a tool that answered with a failure", { success: false }],
    ["a check that failed some other way", null],
  ])("shows %s as unhealthy", async (_, answer) => {
    if (answer) mockTestConnection.mockResolvedValue(answer);
    else
      mockTestConnection.mockRejectedValue(
        failure("INTERNAL_SERVER_ERROR", 500, "Failed to test connection"),
      );
    renderWithClient(<ToolHealthBadge toolId={7} />);
    await waitFor(() => expect(badge()).toHaveAttribute("title", "Unhealthy"));
  });
});

describe("ToolHealthIndicator", () => {
  it("says a refused test wasn't run, and doesn't call the tool disconnected", async () => {
    const onHealthChange = jest.fn();
    mockTestConnection.mockRejectedValue(
      failure("TOO_MANY_REQUESTS", 429, LIMIT_MESSAGE),
    );
    renderWithClient(
      <ToolHealthIndicator
        toolId={7}
        toolName="Mail"
        onHealthChange={onHealthChange}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /test/i }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Not Checked",
        description: LIMIT_MESSAGE,
      }),
    );
    expect(screen.getByText("Not tested")).toBeInTheDocument();
    expect(screen.queryByText("Disconnected")).not.toBeInTheDocument();
    expect(onHealthChange).not.toHaveBeenCalled();
  });

  it("still calls a tool disconnected when its test fails", async () => {
    mockTestConnection.mockRejectedValue(
      failure("INTERNAL_SERVER_ERROR", 500, "Failed to test connection"),
    );
    renderWithClient(<ToolHealthIndicator toolId={7} toolName="Mail" />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /test/i }));
    await waitFor(() =>
      expect(screen.getByText("Disconnected")).toBeInTheDocument(),
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Connection Test Failed",
        variant: "destructive",
      }),
    );
  });
});
