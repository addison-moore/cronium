/**
 * Every action on the event page has to say when it fails. There is no global
 * mutation error handler, and the handlers here swallow rejections, so a mutation
 * without its own handling looks like a click that did nothing.
 *
 * react-query is real, and errors are real TRPCClientErrors in the shape the
 * server's error formatter sends. The status badge and the overview tab are stubs:
 * Radix menus add nothing here, and the badge's stub keeps what the handler
 * returned, because the real one awaits it with only try/finally.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { EventStatus, EventType } from "@/shared/schema";

const mockToast = jest.fn();
const mockPush = jest.fn();
const mockRefetchEvent = jest.fn();
const mockRefetchLogs = jest.fn();
/** Stands in for the server: one function per procedure. */
const mockServer = {
  delete: jest.fn(),
  execute: jest.fn(),
  activate: jest.fn(),
  deactivate: jest.fn(),
  resetCounter: jest.fn(),
  update: jest.fn(),
};
let mockEvent: Record<string, unknown>;
let mockStatusResult: unknown;

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  toast: (...args: unknown[]): unknown => mockToast(...args),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/dashboard/events/1",
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "me" } }),
}));

// The page's effects depend on these by identity, so they have to be stable.
const mockLogsSocket = {
  subscribeToLog: () => undefined,
  unsubscribeFromLog: () => undefined,
  subscribeToLogUpdates: () => undefined,
};
const mockLogsData = { logs: [] };

jest.mock("@/hooks/use-logs-socket", () => ({
  useLogsSocket: () => mockLogsSocket,
}));

jest.mock("@/components/ui/clickable-status-badge", () => {
  const { EventStatus: Status } =
    jest.requireActual<typeof import("@/shared/schema")>("@/shared/schema");
  return {
    ClickableStatusBadge: ({
      currentStatus,
      onStatusChange,
    }: {
      currentStatus: string;
      onStatusChange: (status: string) => unknown;
    }) => (
      <>
        <span data-testid="status">{currentStatus}</span>
        {[Status.ACTIVE, Status.PAUSED, Status.DRAFT].map((status) => (
          <button
            key={status}
            onClick={() => {
              mockStatusResult = onStatusChange(status);
            }}
          >
            {`Set ${status}`}
          </button>
        ))}
      </>
    ),
  };
});

jest.mock("../index", () => ({
  EventDetailsHeader: jest.requireActual<
    typeof import("../EventDetailsHeader")
  >("../EventDetailsHeader").EventDetailsHeader,
  EventDeleteDialog: jest.requireActual<typeof import("../EventDeleteDialog")>(
    "../EventDeleteDialog",
  ).EventDeleteDialog,
  EventOverviewTab: ({
    onResetCounter,
    isResettingCounter,
  }: {
    onResetCounter: () => void;
    isResettingCounter: boolean;
  }) => (
    <button onClick={onResetCounter} disabled={isResettingCounter}>
      {isResettingCounter ? "Resetting..." : "Reset Counter"}
    </button>
  ),
  EventEditTab: () => null,
  EventLogsTab: () => null,
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
      events: {
        getById: {
          useQuery: () => ({
            data: mockEvent,
            isLoading: false,
            refetch: mockRefetchEvent,
          }),
        },
        getLogs: {
          useQuery: () => ({
            data: mockLogsData,
            isLoading: false,
            refetch: mockRefetchLogs,
          }),
        },
        delete: procedure("delete"),
        execute: procedure("execute"),
        activate: procedure("activate"),
        deactivate: procedure("deactivate"),
        resetCounter: procedure("resetCounter"),
        update: procedure("update"),
      },
    },
  };
});

import { EventDetails } from "../EventDetails";

function trpcError(
  message: string,
  data: Record<string, unknown> = {},
): TRPCClientError<never> {
  return TRPCClientError.from({
    error: {
      message,
      code: -32603,
      data: { code: "FORBIDDEN", httpStatus: 403, zodError: null, ...data },
    },
  });
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EventDetails eventId="1" />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const button = (name: string) => screen.getByRole("button", { name });

async function waitForToast() {
  await waitFor(() => expect(mockToast).toHaveBeenCalled());
}

const errorToast = (description: string) => ({
  title: "Error",
  description,
  variant: "destructive",
});

beforeEach(() => {
  jest.resetAllMocks();
  mockStatusResult = undefined;
  mockEvent = {
    id: 1,
    userId: "me",
    name: "nightly",
    description: null,
    type: EventType.BASH,
    status: EventStatus.PAUSED,
    content: "echo hi",
    scheduleNumber: 1,
    scheduleUnit: "MINUTES",
    customSchedule: null,
    createdAt: "2026-11-05T00:00:00.000Z",
    updatedAt: "2026-11-05T00:00:00.000Z",
    lastRunAt: null,
    nextRunAt: null,
    tags: [],
    envVars: [],
  };
});

// One row per action: the click, the procedure it calls, and what it says when
// the error has no message of its own.
const actions = [
  ["Run Now", "execute", "Failed to run event"],
  ["Reset Counter", "resetCounter", "Failed to reset the counter"],
  [`Set ${EventStatus.ACTIVE}`, "activate", "Failed to activate event"],
  [`Set ${EventStatus.PAUSED}`, "deactivate", "Failed to pause event"],
  [`Set ${EventStatus.DRAFT}`, "update", "Failed to update event"],
] as const;

describe("EventDetails when the server refuses", () => {
  const reason = "A previous run of this event is still active";

  it.each(actions)(
    "%s shows the server's reason, once",
    async (name, procedure) => {
      mockServer[procedure].mockRejectedValue(trpcError(reason));
      const user = renderPage();

      await user.click(button(name));
      await waitForToast();

      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(errorToast(reason));
    },
  );

  it.each(actions)(
    "%s still says something when the error has no message",
    async (name, procedure, fallback) => {
      mockServer[procedure].mockRejectedValue(trpcError(""));
      const user = renderPage();

      await user.click(button(name));
      await waitForToast();

      expect(mockToast).toHaveBeenCalledWith(errorToast(fallback));
    },
  );

  it.each(actions)(
    "%s gives a validation failure's sentences, not its JSON",
    async (name, procedure) => {
      mockServer[procedure].mockRejectedValue(
        trpcError('[{"code":"invalid_type","path":["id"]}]', {
          code: "BAD_REQUEST",
          httpStatus: 400,
          zodError: {
            formErrors: [],
            fieldErrors: { id: ["This event can't be changed"] },
          },
        }),
      );
      const user = renderPage();

      await user.click(button(name));
      await waitForToast();

      expect(mockToast).toHaveBeenCalledWith(
        errorToast("This event can't be changed"),
      );
    },
  );

  it.each(actions)(
    "%s doesn't refresh the page as if it had worked",
    async (name, procedure) => {
      mockServer[procedure].mockRejectedValue(trpcError(reason));
      const user = renderPage();

      await user.click(button(name));
      await waitForToast();

      expect(mockRefetchEvent).not.toHaveBeenCalled();
      expect(mockRefetchLogs).not.toHaveBeenCalled();
      expect(screen.getByTestId("status")).toHaveTextContent(
        EventStatus.PAUSED,
      );
    },
  );

  it.each(actions.slice(2))(
    "%s leaves the badge nothing to re-throw into",
    async (name, procedure) => {
      mockServer[procedure].mockRejectedValue(trpcError(reason));
      const user = renderPage();

      await user.click(button(name));
      await waitForToast();

      // The real badge has try/finally and no catch.
      await expect(mockStatusResult).resolves.toBeUndefined();
    },
  );

  it("Run Now and Reset Counter come back after a refusal", async () => {
    mockServer.execute.mockRejectedValue(trpcError(reason));
    mockServer.resetCounter.mockRejectedValue(trpcError(reason));
    const user = renderPage();

    await user.click(button("Run Now"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button("Run Now")).toBeEnabled());

    await user.click(button("Reset Counter"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button("Reset Counter")).toBeEnabled());
  });

  it("two overlapping runs both report", async () => {
    let refuseFirst: (error: unknown) => void = () => undefined;
    mockServer.execute
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          refuseFirst = reject;
        }),
      )
      .mockRejectedValueOnce(trpcError("second"));
    renderPage();

    // The button is disabled while a run is in flight, so this is two calls on
    // the one observer the way a double click could make them.
    const run = button("Run Now");
    act(() => {
      run.click();
      run.click();
    });
    await waitFor(() => expect(mockServer.execute).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));

    await act(async () => {
      refuseFirst(trpcError("first"));
    });

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(2));
    expect(mockToast).toHaveBeenCalledWith(errorToast("first"));
    expect(mockToast).toHaveBeenCalledWith(errorToast("second"));
  });

  describe("Delete", () => {
    async function confirmDelete() {
      const user = renderPage();
      await user.click(button("Delete"));
      const dialog = await screen.findByRole("alertdialog");
      const confirm = Array.from(dialog.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === "Delete",
      );
      await user.click(confirm!);
    }

    it("shows the reason, once, and stays on the page", async () => {
      mockServer.delete.mockRejectedValue(trpcError(reason));

      await confirmDelete();
      await waitForToast();

      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(errorToast(reason));
      expect(mockPush).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
      );
      expect(screen.getByText("nightly")).toBeInTheDocument();
    });

    it("still goes back to the list when it works", async () => {
      mockServer.delete.mockResolvedValue({ success: true });

      await confirmDelete();
      await waitForToast();

      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Event Deleted", variant: "success" }),
      );
      expect(mockPush).toHaveBeenCalledWith("/dashboard/events");
    });
  });
});

describe("EventDetails when the server agrees", () => {
  it.each([
    ["Run Now", "execute", "Event Executed"],
    ["Reset Counter", "resetCounter", "Counter Reset"],
    [`Set ${EventStatus.ACTIVE}`, "activate", "Event Activated"],
    [`Set ${EventStatus.PAUSED}`, "deactivate", "Event Paused"],
    [`Set ${EventStatus.DRAFT}`, "update", "Event Updated"],
  ] as const)("%s says only that it worked", async (name, procedure, title) => {
    mockServer[procedure].mockResolvedValue({ success: true });
    const user = renderPage();

    await user.click(button(name));
    await waitForToast();

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title, variant: "success" }),
    );
  });
});
