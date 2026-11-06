/**
 * Rotating a workflow's webhook key has to say when it fails, and must not look
 * like it changed the key when it didn't. react-query is real, errors are real
 * TRPCClientErrors, and the page's heavy tabs are stubs.
 */
import React, { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { EventStatus, WorkflowTriggerType } from "@/shared/schema";

const mockToast = jest.fn();
const mockRotate = jest.fn();
// The page's effects depend on these by identity, so they have to be stable.
const mockToastHandle = {
  toast: (...args: unknown[]): unknown => mockToast(...args),
};
const mockWorkflowData = {
  data: {
    id: 9,
    userId: "me",
    name: "Deploy",
    description: null,
    triggerType: WorkflowTriggerType.WEBHOOK,
    hasWebhookKey: true,
    status: EventStatus.ACTIVE,
    tags: [],
    nodes: [],
    connections: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  },
};
const mockExecutions = { data: { executions: [], total: 0 } };
const mockEvents = { events: [] };

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  useToast: () => mockToastHandle,
}));

const mockRouter = { push: jest.fn() };
jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/dashboard/workflows/9",
}));

jest.mock("@/components/workflows/WorkflowExecutionHistory", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/workflows/WorkflowExecutionGraph", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/workflows/WorkflowCanvas-lazy", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/workflows/WorkflowDetailsForm", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/lib/trpc", () => {
  const { useMutation } = jest.requireActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  const unused = { useMutation: () => ({ mutateAsync: jest.fn() }) };
  return {
    trpc: {
      useContext: () => ({ workflows: { getById: { invalidate: jest.fn() } } }),
      events: {
        getAll: {
          useQuery: () => ({ data: mockEvents, isLoading: false }),
        },
      },
      workflows: {
        getById: {
          useQuery: () => ({
            data: mockWorkflowData,
            isLoading: false,
            error: null,
          }),
        },
        getExecutions: { useQuery: () => ({ data: mockExecutions }) },
        update: unused,
        execute: unused,
        delete: unused,
        rotateWebhookKey: {
          useMutation: (options?: object) =>
            useMutation({
              mutationFn: (input: unknown): Promise<unknown> =>
                mockRotate(input) as Promise<unknown>,
              ...options,
            }),
        },
      },
    },
  };
});

import WorkflowDetailsPage from "../page";

async function renderPage() {
  const params = Promise.resolve({ id: "9" });
  await act(async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Suspense fallback={null}>
          <WorkflowDetailsPage params={params} />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  await screen.findByRole("button", { name: "Rotate webhook key" });
  return userEvent.setup();
}

const rotate = () => screen.getByRole("button", { name: "Rotate webhook key" });

function refusal(message: string): TRPCClientError<never> {
  return TRPCClientError.from({
    error: {
      message,
      code: -32004,
      data: { code: "NOT_FOUND", httpStatus: 404, zodError: null },
    },
  });
}

beforeEach(() => {
  mockToast.mockReset();
  mockRotate.mockReset();
});

describe("Rotate webhook key", () => {
  it("shows the server's reason, once, when it's refused", async () => {
    mockRotate.mockRejectedValue(refusal("Workflow not found"));
    const user = await renderPage();

    await user.click(rotate());

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith({
      title: "Error",
      description: "Workflow not found",
      variant: "destructive",
    });
    await waitFor(() => expect(rotate()).toBeEnabled());
  });

  it("still says something when the error has no message", async () => {
    mockRotate.mockRejectedValue(refusal(""));
    const user = await renderPage();

    await user.click(rotate());

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Error",
        description: "Failed to rotate the webhook key",
        variant: "destructive",
      }),
    );
  });

  it("keeps showing the key that's still valid when a later rotation fails", async () => {
    mockRotate.mockResolvedValueOnce({ webhookKey: "key-that-works" });
    const user = await renderPage();
    await user.click(rotate());
    await waitFor(() =>
      expect(screen.getAllByText(/key-that-works/).length).toBeGreaterThan(0),
    );

    mockRotate.mockRejectedValueOnce(refusal("Workflow not found"));
    await user.click(rotate());
    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));

    expect(screen.getAllByText(/key-that-works/).length).toBeGreaterThan(0);
  });

  it("shows no key when the first rotation fails", async () => {
    mockRotate.mockRejectedValue(refusal("Workflow not found"));
    const user = await renderPage();

    await user.click(rotate());
    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    expect(screen.getByText(/<your-key>/)).toBeInTheDocument();
  });
});
