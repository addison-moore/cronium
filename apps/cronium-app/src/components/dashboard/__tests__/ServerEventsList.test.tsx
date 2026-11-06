/**
 * The events on a server's page. These rows come from servers.getEvents through
 * the page's own mapper, so what Duplicate can copy depends on what the mapper
 * keeps. The real table and menu, with tRPC and useAuth stubbed.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventStatus, EventType, RunLocation } from "@shared/schema";

const VIEWER = "user-viewer";
const OTHER = "user-other";

const mockToast = jest.fn();
const mockCreate = jest.fn();
const mockFork = jest.fn();
const mockRefetch = jest.fn();

interface MutationOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

function dbEvent(overrides: Record<string, unknown>) {
  return {
    description: null,
    shared: false,
    type: EventType.BASH,
    status: EventStatus.PAUSED,
    content: "echo hi",
    scheduleNumber: 1,
    scheduleUnit: "MINUTES",
    customSchedule: null,
    userId: VIEWER,
    createdAt: new Date("2026-11-05T00:00:00Z"),
    updatedAt: new Date("2026-11-05T00:00:00Z"),
    lastRunAt: null,
    nextRunAt: null,
    tags: [],
    serverId: null,
    runLocation: RunLocation.REMOTE,
    timeoutValue: 30,
    timeoutUnit: "SECONDS",
    retries: 0,
    ...overrides,
  };
}

// As toEventListApiDto answers: a shared viewer gets no server bindings.
const mockEvents = [
  dbEvent({ id: 1, name: "on-two", eventServers: [6, 7] }),
  dbEvent({ id: 2, name: "on-one", eventServers: [6] }),
  dbEvent({
    id: 3,
    name: "theirs",
    userId: OTHER,
    shared: true,
    eventServers: [],
  }),
];

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-viewer" }, session: null }),
}));

jest.mock("@/lib/trpc", () => {
  const idle = { useMutation: () => ({ mutateAsync: jest.fn() }) };
  // Takes a function because the factory runs before the mocks above exist.
  const procedure = (call: (input: unknown) => unknown) => ({
    useMutation: ({ onSuccess, onError }: MutationOptions) => ({
      mutateAsync: async (input: unknown) => {
        try {
          const result: unknown = await call(input);
          onSuccess?.();
          return result;
        } catch (error) {
          onError?.(error as Error);
          throw error;
        }
      },
    }),
  });
  return {
    trpc: {
      servers: {
        getEvents: {
          useQuery: () => ({
            data: { events: mockEvents, total: 3, hasMore: false },
            isLoading: false,
            refetch: mockRefetch,
          }),
        },
        getAll: {
          useQuery: () => ({
            data: { servers: [{ id: 6, name: "box-a" }] },
          }),
        },
      },
      events: {
        execute: idle,
        update: idle,
        delete: idle,
        create: procedure((input) => mockCreate(input)),
        fork: procedure((input) => mockFork(input)),
      },
    },
  };
});

import ServerEventsList from "../ServerEventsList";

function row(name: string): HTMLElement {
  return screen.getByRole("link", { name }).closest("tr")!;
}

async function choose(rowName: string, action: string) {
  const user = userEvent.setup();
  await user.click(
    within(row(rowName)).getByRole("button", { name: "Open menu" }),
  );
  await user.click(screen.getByRole("menuitem", { name: action }));
}

describe("ServerEventsList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the servers an event is linked to, not local", () => {
    render(<ServerEventsList serverId={6} />);

    expect(within(row("on-two")).getByText("multi-server")).toBeInTheDocument();
    expect(within(row("on-one")).getByText("box-a")).toBeInTheDocument();
  });

  describe("Duplicate", () => {
    it("copies all of the event's server links", async () => {
      mockCreate.mockResolvedValue({ id: 10 });
      render(<ServerEventsList serverId={6} />);

      await choose("on-two", "Duplicate");

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      expect(mockCreate.mock.calls[0]![0]).toMatchObject({
        name: "on-two (copy)",
        status: EventStatus.DRAFT,
        runLocation: RunLocation.REMOTE,
        selectedServerIds: [6, 7],
      });
      await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
    });

    it("shows a refusal's plain message, not a JSON dump", async () => {
      const message = "Server selection is required for remote execution";
      mockCreate.mockRejectedValue(
        Object.assign(new Error(JSON.stringify([{ message }])), {
          data: {
            zodError: { formErrors: [], fieldErrors: { serverId: [message] } },
          },
        }),
      );
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      render(<ServerEventsList serverId={6} />);

      await choose("on-one", "Duplicate");

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({
          title: "Error",
          description: message,
          variant: "destructive",
        }),
      );
      jest.restoreAllMocks();
    });
  });

  describe("Fork", () => {
    it("forks on the server rather than copying what the row was given", async () => {
      mockFork.mockResolvedValue({ id: 11 });
      render(<ServerEventsList serverId={6} />);

      await choose("theirs", "Fork");

      await waitFor(() => expect(mockFork).toHaveBeenCalledWith({ id: 3 }));
      expect(mockCreate).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Event Forked" }),
        ),
      );
    });

    it("shows the server's reason when a fork is refused", async () => {
      const reason = "You do not have the required capability for this event";
      mockFork.mockRejectedValue(new Error(reason));
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      render(<ServerEventsList serverId={6} />);

      await choose("theirs", "Fork");

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({
          title: "Error",
          description: reason,
          variant: "destructive",
        }),
      );
      jest.restoreAllMocks();
    });
  });
});
