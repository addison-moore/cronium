/**
 * The assistant sits inside the event form, so someone whose session has gone needs the
 * same words here as everywhere else, and a refusal that isn't about the session has to
 * keep its own. react-query is real, and errors are real TRPCClientErrors.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { EventType } from "@/shared/schema";

const mockToast = jest.fn();
const mockGenerate = jest.fn();

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  toast: (...args: unknown[]): unknown => mockToast(...args),
  MonacoEditor: () => null,
}));

jest.mock("@/lib/trpc", () => {
  const { useMutation } = jest.requireActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  return {
    trpc: {
      settings: {
        getAIStatus: {
          useQuery: () => ({
            data: { data: { enabled: true } },
            isLoading: false,
          }),
        },
      },
      ai: {
        generateScript: {
          useMutation: (options?: object) =>
            useMutation({
              mutationFn: (input: unknown): Promise<unknown> =>
                mockGenerate(input) as Promise<unknown>,
              ...options,
            }),
        },
      },
    },
  };
});

import AIScriptAssistant from "../AIScriptAssistant";

function refusal(code: string, message: string): TRPCClientError<never> {
  return TRPCClientError.from({
    error: { message, code: -32001, data: { code } },
  });
}

function pressGenerate() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AIScriptAssistant onApplyCode={jest.fn()} scriptType={EventType.BASH} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText(/Describe what you want/), {
    target: { value: "print the date" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate Code" }));
}

const shownToasts = () =>
  mockToast.mock.calls.map(
    ([shown]) => (shown as { description: string }).description,
  );

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AIScriptAssistant when a generation is refused", () => {
  it.each([
    // The link in lib/trpc.ts has already put this on an ended session's error.
    "Your session has expired or you've been signed out.",
    "Account is not active",
    // What withErrorHandling makes of the Anthropic SDK's error for a key it refuses.
    'Failed to generate code: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
  ])("shows UNAUTHORIZED's own message: %s", async (message) => {
    mockGenerate.mockRejectedValue(refusal("UNAUTHORIZED", message));

    pressGenerate();

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    await waitFor(() => expect(shownToasts()).toContain(message));
    expect(shownToasts()).not.toContain(
      "You need to be logged in to use the AI assistant",
    );
  });

  it("still words the codes it knows about", async () => {
    mockGenerate.mockRejectedValue(
      refusal("FORBIDDEN", "AI script generation is not enabled"),
    );

    pressGenerate();

    await waitFor(() =>
      expect(shownToasts()).toContain(
        "AI script assistant is not enabled by the administrator",
      ),
    );
  });
});
