/**
 * A run or an activation the server refuses has to reach the screen, because the
 * reason is how an owner learns what to do, such as that the event has no servers.
 * The mutations fail the way tRPC's do: onError first, then a rejected mutateAsync.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "@cronium/ui";
import { NO_SERVERS_MESSAGE } from "@/shared/event-servers";
import { EventStatus } from "@/shared/schema";
import { EventDetails } from "../EventDetails";

const mockFailures: Record<string, unknown> = {};

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<typeof import("@cronium/ui")>("@cronium/ui"),
  toast: jest.fn(),
}));

jest.mock("@/lib/trpc", () => {
  const mutation = (name: string) => ({
    useMutation: (options?: { onError?: (error: unknown) => void }) => ({
      mutateAsync: async () => {
        const failure = mockFailures[name];
        if (failure) {
          options?.onError?.(failure);
          throw failure;
        }
      },
    }),
  });
  // Stable, as React Query's are: the page's effects depend on these.
  const eventQuery = {
    data: {
      id: 1,
      name: "the event",
      userId: "owner",
      type: "BASH",
      status: "PAUSED",
      runLocation: "REMOTE",
      servers: [],
      envVars: [],
      tags: [],
    },
    isLoading: false,
    refetch: jest.fn(),
  };
  const logsQuery = {
    data: { logs: [], total: 0 },
    isLoading: false,
    refetch: jest.fn(),
  };
  return {
    trpc: {
      events: {
        getById: { useQuery: () => eventQuery },
        getLogs: { useQuery: () => logsQuery },
        delete: mutation("delete"),
        execute: mutation("execute"),
        activate: mutation("activate"),
        deactivate: mutation("deactivate"),
        resetCounter: mutation("resetCounter"),
        update: mutation("update"),
      },
    },
  };
});

jest.mock("@/hooks/useAuth", () => {
  const auth = { user: { id: "owner" } };
  return { useAuth: () => auth };
});
jest.mock("@/hooks/use-logs-socket", () => {
  const socket = {
    subscribeToLog: jest.fn(),
    unsubscribeFromLog: jest.fn(),
    subscribeToLogUpdates: jest.fn(() => jest.fn()),
  };
  return { useLogsSocket: () => socket };
});
jest.mock("@/hooks/useHashTabNavigation", () => {
  const navigation = { activeTab: "overview", changeTab: jest.fn() };
  return { useHashTabNavigation: () => navigation };
});

// Only the header's two actions are under test here.
jest.mock("../index", () => ({
  EventDetailsHeader: ({
    onRun,
    onStatusChange,
  }: {
    onRun: () => Promise<void>;
    onStatusChange: (status: EventStatus) => Promise<void>;
  }) => (
    <div>
      <button onClick={() => void onRun()}>Run</button>
      <button onClick={() => void onStatusChange(EventStatus.ACTIVE)}>
        Activate
      </button>
    </div>
  ),
  EventOverviewTab: () => null,
  EventEditTab: () => null,
  EventLogsTab: () => null,
  EventDeleteDialog: () => null,
}));

const zodFailure = {
  message: '[{"code":"too_small","path":["id"],"message":"raw JSON"}]',
  data: {
    zodError: {
      formErrors: [],
      fieldErrors: { id: ["Event ID must be a positive integer"] },
    },
  },
};

async function press(button: string) {
  render(<EventDetails eventId="1" />);
  await userEvent.click(screen.getByRole("button", { name: button }));
}

beforeEach(() => {
  for (const name of Object.keys(mockFailures)) delete mockFailures[name];
  jest.mocked(toast).mockClear();
});

describe("a refused action on the event details page", () => {
  describe.each([
    ["Run", "execute", "Failed to run event"],
    ["Activate", "activate", "Failed to activate event"],
  ])("%s", (button, mutation, fallback) => {
    it("says why", async () => {
      mockFailures[mutation] = new Error(NO_SERVERS_MESSAGE);

      await press(button);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith({
          title: "Error",
          description: NO_SERVERS_MESSAGE,
          variant: "destructive",
        }),
      );
    });

    it("reads an input check's sentences, not its raw JSON", async () => {
      mockFailures[mutation] = zodFailure;

      await press(button);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            description: "Event ID must be a positive integer",
          }),
        ),
      );
    });

    it("still says something when the error has no message", async () => {
      mockFailures[mutation] = {};

      await press(button);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ description: fallback }),
        ),
      );
    });
  });

  it("doesn't report a failure when the run is accepted", async () => {
    await press("Run");

    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });
});
