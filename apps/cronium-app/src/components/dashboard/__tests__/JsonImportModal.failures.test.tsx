/**
 * The JSON dialog has to give a person sentences when the server refuses. A failed
 * validation's `message` is its Zod issues as a JSON array. react-query is real, and
 * errors are real TRPCClientErrors.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";

const mockToast = jest.fn();
const mockPush = jest.fn();
const mockCreate = jest.fn();

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "me" } }),
}));

jest.mock("@/lib/trpc", () => {
  const { useMutation } = jest.requireActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  return {
    trpc: {
      events: {
        create: {
          useMutation: (options?: object) =>
            useMutation({
              mutationFn: (input: unknown): Promise<unknown> =>
                mockCreate(input) as Promise<unknown>,
              ...options,
            }),
        },
      },
    },
  };
});

import { JsonImportModal } from "../JsonImportModal";

function renderModal() {
  const onClose = jest.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <JsonImportModal isOpen onClose={onClose} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByPlaceholderText(/Paste your JSON/), {
    target: {
      value: JSON.stringify({ name: "x", type: "BASH", content: "echo hi" }),
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create Event" }));
  return onClose;
}

function refusal(
  message: string,
  zodError: unknown = null,
): TRPCClientError<never> {
  return TRPCClientError.from({
    error: {
      message,
      code: -32600,
      data: { code: "BAD_REQUEST", httpStatus: 400, zodError },
    },
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("JsonImportModal when the server refuses", () => {
  it("gives a validation failure's sentences, not its JSON", async () => {
    mockCreate.mockRejectedValue(
      refusal('[{"code":"too_small","path":["name"]}]', {
        formErrors: [],
        fieldErrors: { name: ["Event name is required"] },
      }),
    );

    const onClose = renderModal();

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith({
      title: "Error",
      description: "Event name is required",
      variant: "destructive",
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("gives any other refusal as it stands", async () => {
    mockCreate.mockRejectedValue(refusal("You can't create events"));

    renderModal();

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Error",
        description: "You can't create events",
        variant: "destructive",
      }),
    );
  });

  it("still says something when the error has no message", async () => {
    mockCreate.mockRejectedValue(refusal(""));

    renderModal();

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Error",
        description: "Failed to create event",
        variant: "destructive",
      }),
    );
  });
});
