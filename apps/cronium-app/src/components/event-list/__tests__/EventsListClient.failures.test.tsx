/**
 * Every action in the events list has to tell the person when it fails. There is
 * no global mutation error handler, and the handlers here swallow rejections, so
 * a mutation without its own handling looks like a click that did nothing.
 *
 * react-query is real, because what these tests pin down depends on how it
 * behaves: a useMutation's callbacks run once per call, so bulk actions can't use
 * them, and they run for every call even when two overlap. Errors are real
 * TRPCClientErrors, in the shape the server's error formatter sends. The table is
 * a stub because Radix menus add nothing here; the toolbar is the real one.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { EventStatus, EventType } from "@/shared/schema";
import type { Event } from "@/components/event-list";

const mockToast = jest.fn();
/** Stands in for the server: one function per procedure. */
const mockServer = {
  delete: jest.fn(),
  execute: jest.fn(),
  create: jest.fn(),
  fork: jest.fn(),
  update: jest.fn(),
  activate: jest.fn(),
  deactivate: jest.fn(),
  download: jest.fn(),
};
let mockConfirmResult: unknown;

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  useToast: () => ({ toast: mockToast }),
  // Keeps what onConfirm returned: the real dialog awaits it with no catch, so a
  // rejection would be unhandled.
  ConfirmationDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: () => unknown;
  }) =>
    open ? (
      <button
        onClick={() => {
          mockConfirmResult = onConfirm();
        }}
      >
        Confirm delete
      </button>
    ) : null,
}));

jest.mock("@/hooks/use-persistent-pagination", () => ({
  usePersistentPagination: () => ({
    itemsPerPage: 10,
    setItemsPerPage: jest.fn(),
  }),
}));

jest.mock("@/components/event-list", () => {
  const { EventStatus: Status } =
    jest.requireActual<typeof import("@/shared/schema")>("@/shared/schema");
  const { BulkActionsToolbar } = jest.requireActual<
    typeof import("../bulk-actions-toolbar")
  >("../bulk-actions-toolbar");
  return {
    EventsFilters: () => null,
    BulkActionsToolbar,
    EventsTable: ({
      events,
      selectedEvents,
      onSelectedEventsChange,
      onEventRun,
      onEventDuplicate,
      onEventFork,
      onEventStatusChange,
      onEventDelete,
    }: {
      events: Event[];
      selectedEvents: Set<number>;
      onSelectedEventsChange: (selected: Set<number>) => void;
      onEventRun: (id: number) => void;
      onEventDuplicate: (id: number) => void;
      onEventFork: (id: number) => void;
      onEventStatusChange: (id: number, status: EventStatus) => void;
      onEventDelete: (id: number) => void;
    }) => (
      <>
        {events.map((event) => (
          <div key={event.id} data-testid={`row-${event.name}`}>
            <span data-testid="status">{event.status}</span>
            <button onClick={() => onEventRun(event.id)}>Run</button>
            <button onClick={() => onEventDuplicate(event.id)}>
              Duplicate
            </button>
            <button onClick={() => onEventFork(event.id)}>Fork</button>
            <button
              onClick={() => onEventStatusChange(event.id, Status.ACTIVE)}
            >
              Active
            </button>
            <button
              onClick={() => onEventStatusChange(event.id, Status.PAUSED)}
            >
              Paused
            </button>
            <button onClick={() => onEventStatusChange(event.id, Status.DRAFT)}>
              Draft
            </button>
            <button
              onClick={() => onEventStatusChange(event.id, Status.ARCHIVED)}
            >
              Archive
            </button>
            <button onClick={() => onEventDelete(event.id)}>Delete</button>
            <button
              onClick={() =>
                onSelectedEventsChange(new Set([...selectedEvents, event.id]))
              }
            >
              Select
            </button>
          </div>
        ))}
        <button onClick={() => onEventDuplicate(999)}>Duplicate missing</button>
      </>
    ),
  };
});

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
        delete: procedure("delete"),
        execute: procedure("execute"),
        create: procedure("create"),
        fork: procedure("fork"),
        update: procedure("update"),
        activate: procedure("activate"),
        deactivate: procedure("deactivate"),
        download: procedure("download"),
      },
    },
  };
});

import { EventsListClient } from "../EventsListClient";

function makeEvent(id: number, overrides: Partial<Event> = {}): Event {
  return {
    id,
    name: `event-${id}`,
    description: null,
    type: EventType.BASH,
    status: EventStatus.DRAFT,
    content: "echo hi",
    scheduleNumber: 1,
    scheduleUnit: "MINUTES",
    customSchedule: null,
    userId: "me",
    createdAt: "2026-11-05T00:00:00.000Z",
    updatedAt: "2026-11-05T00:00:00.000Z",
    lastRunAt: null,
    nextRunAt: null,
    ...overrides,
  };
}

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

function renderList(events: Event[] = [makeEvent(1)]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EventsListClient initialEvents={events} servers={[]} workflows={[]} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

function rowButton(name: string, button: string) {
  return within(screen.getByTestId(`row-${name}`)).getByRole("button", {
    name: button,
  });
}

function statusOf(name: string) {
  return within(screen.getByTestId(`row-${name}`)).getByTestId("status")
    .textContent;
}

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
  mockConfirmResult = undefined;
});

describe("an action on one event", () => {
  const reason = "You do not have the required capability for this event";

  it.each([
    ["Run", "execute", EventStatus.PAUSED],
    ["Duplicate", "create", EventStatus.PAUSED],
    ["Fork", "fork", EventStatus.PAUSED],
    ["Active", "activate", EventStatus.PAUSED],
    ["Paused", "deactivate", EventStatus.ACTIVE],
    ["Draft", "update", EventStatus.ACTIVE],
    ["Archive", "update", EventStatus.ACTIVE],
  ] as const)(
    "%s shows the server's reason, once, and leaves the row as it was",
    async (button, procedure, status) => {
      mockServer[procedure].mockRejectedValue(trpcError(reason));
      const user = renderList([makeEvent(1, { status })]);

      await user.click(rowButton("event-1", button));
      await waitForToast();

      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(errorToast(reason));
      expect(statusOf("event-1")).toBe(status);
    },
  );

  it.each([
    ["Run", "execute", "Failed to run event"],
    ["Duplicate", "create", "Failed to duplicate event"],
    ["Fork", "fork", "Failed to fork event"],
    ["Active", "activate", "Failed to activate event"],
    ["Paused", "deactivate", "Failed to pause event"],
    ["Draft", "update", "Failed to update event"],
  ] as const)(
    "%s still says something when the error has no message",
    async (button, procedure, fallback) => {
      mockServer[procedure].mockRejectedValue(trpcError(""));
      const user = renderList();

      await user.click(rowButton("event-1", button));
      await waitForToast();

      expect(mockToast).toHaveBeenCalledWith(errorToast(fallback));
    },
  );

  it.each([
    ["Run", "execute", "Event Executed"],
    ["Duplicate", "create", "Success"],
    ["Fork", "fork", "Success"],
    ["Active", "activate", "Success"],
    ["Paused", "deactivate", "Success"],
    ["Draft", "update", "Success"],
  ] as const)(
    "%s says only that it worked when it does",
    async (button, procedure, title) => {
      mockServer[procedure].mockResolvedValue({ success: true });
      const user = renderList();

      await user.click(rowButton("event-1", button));
      await waitForToast();

      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title, variant: "success" }),
      );
    },
  );

  it("reports both failures when two runs overlap", async () => {
    // What a callback passed to mutateAsync would lose: a second call on the same
    // observer stops the first call's callbacks from running at all.
    const rejects: Array<(error: Error) => void> = [];
    mockServer.execute.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejects.push(reject);
        }),
    );
    const user = renderList([makeEvent(1), makeEvent(2)]);

    await user.click(rowButton("event-1", "Run"));
    await user.click(rowButton("event-2", "Run"));
    await waitFor(() => expect(rejects).toHaveLength(2));
    rejects[0]?.(trpcError("First reason"));
    rejects[1]?.(trpcError("Second reason"));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(2));
    expect(mockToast).toHaveBeenCalledWith(errorToast("First reason"));
    expect(mockToast).toHaveBeenCalledWith(errorToast("Second reason"));
  });
});

describe("Duplicate", () => {
  it("shows a validation failure's sentence, not its JSON", async () => {
    const sentence =
      "Tool action configuration is required for tool action events";
    mockServer.create.mockRejectedValue(
      trpcError(
        JSON.stringify([
          { code: "custom", path: ["toolActionConfig"], message: sentence },
        ]),
        {
          code: "BAD_REQUEST",
          httpStatus: 400,
          zodError: {
            formErrors: [],
            fieldErrors: { toolActionConfig: [sentence] },
          },
        },
      ),
    );
    const user = renderList();

    await user.click(rowButton("event-1", "Duplicate"));
    await waitForToast();

    expect(mockToast).toHaveBeenCalledWith(errorToast(sentence));
  });

  it("shows why an event too long for one request can't be copied", async () => {
    const reason =
      "This event is too long to save, usually because of its script. One request can carry at most 10 MB, counted as JSON, where each line break or quote takes 2 bytes.";
    mockServer.create.mockRejectedValue(
      trpcError(reason, { code: "PAYLOAD_TOO_LARGE", httpStatus: 413 }),
    );
    const user = renderList();

    await user.click(rowButton("event-1", "Duplicate"));
    await waitForToast();

    expect(mockToast).toHaveBeenCalledWith(errorToast(reason));
  });

  it("says so when the event is no longer in the list", async () => {
    const user = renderList();

    await user.click(screen.getByRole("button", { name: "Duplicate missing" }));
    await waitForToast();

    expect(mockToast).toHaveBeenCalledWith(errorToast("Event not found"));
    expect(mockServer.create).not.toHaveBeenCalled();
  });
});

describe("Delete", () => {
  async function confirmDelete() {
    const user = renderList();
    await user.click(rowButton("event-1", "Delete"));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitForToast();
    return user;
  }

  it("shows the server's reason, keeps the row, and doesn't reject", async () => {
    mockServer.delete.mockRejectedValue(trpcError("Event not found"));

    await confirmDelete();

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(errorToast("Event not found"));
    expect(screen.getByTestId("row-event-1")).toBeInTheDocument();
    await expect(mockConfirmResult).resolves.toBeUndefined();
  });

  it("removes the row when it works", async () => {
    mockServer.delete.mockResolvedValue({ success: true });

    await confirmDelete();

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("row-event-1")).not.toBeInTheDocument(),
    );
  });
});

describe.each([
  {
    action: "activate",
    button: "Activate selected events",
    procedure: "activate",
    done: "Activated",
    before: EventStatus.PAUSED,
    after: EventStatus.ACTIVE,
  },
  {
    action: "pause",
    button: "Pause selected events",
    procedure: "deactivate",
    done: "Paused",
    before: EventStatus.ACTIVE,
    after: EventStatus.PAUSED,
  },
  {
    action: "archive",
    button: "Archive selected events",
    procedure: "update",
    done: "Archived",
    before: EventStatus.ACTIVE,
    after: EventStatus.ARCHIVED,
  },
] as const)(
  "bulk $action",
  ({ action, button, procedure, done, before, after }) => {
    async function runOnThree(respond: (id: number) => unknown) {
      mockServer[procedure].mockImplementation(
        ({ id }: { id: number }): unknown => respond(id),
      );
      const user = renderList(
        [1, 2, 3].map((id) => makeEvent(id, { status: before })),
      );
      for (const id of [1, 2, 3]) {
        await user.click(rowButton(`event-${id}`, "Select"));
      }
      await user.click(screen.getByTitle(button));
      await waitForToast();
    }

    // The list's default filter hides archived events.
    const shown = (name: string) =>
      screen.queryByTestId(`row-${name}`) ? statusOf(name) : "hidden";
    const afterShown = after === EventStatus.ARCHIVED ? "hidden" : after;

    it("gives one summary with the reason, and changes only the rows that worked", async () => {
      await runOnThree((id) =>
        id === 2
          ? Promise.reject(trpcError("Event not found"))
          : Promise.resolve({ success: true }),
      );

      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith({
        title: "Partial Success",
        description: `${done} 2 of 3 event(s). 1 failed: Event not found`,
        variant: "info",
      });
      await waitFor(() => expect(shown("event-1")).toBe(afterShown));
      expect(shown("event-2")).toBe(before);
      expect(shown("event-3")).toBe(afterShown);
    });

    it("is an error, with each reason once, when nothing worked", async () => {
      await runOnThree((id) =>
        Promise.reject(trpcError(id === 3 ? "Event not found" : "Not allowed")),
      );

      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        errorToast(
          `Failed to ${action} 3 event(s): Not allowed; Event not found`,
        ),
      );
      for (const name of ["event-1", "event-2", "event-3"]) {
        expect(shown(name)).toBe(before);
      }
    });

    it("gives one toast when everything worked", async () => {
      await runOnThree(() => Promise.resolve({ success: true }));

      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith({
        title: "Success",
        description: `Successfully ${done.toLowerCase()} 3 event(s).`,
        variant: "success",
      });
    });
  },
);

describe("bulk delete", () => {
  async function deleteTwo(respond: (id: number) => unknown) {
    mockServer.delete.mockImplementation(({ id }: { id: number }): unknown =>
      respond(id),
    );
    const user = renderList([makeEvent(1), makeEvent(2)]);
    await user.click(rowButton("event-1", "Select"));
    await user.click(rowButton("event-2", "Select"));
    await user.click(screen.getByTitle("Delete selected events"));
    await waitForToast();
  }

  it("keeps a row the server refused to delete, and says why", async () => {
    const reason = "You do not have the required capability for this event";
    await deleteTwo((id) =>
      id === 2
        ? Promise.reject(trpcError(reason))
        : Promise.resolve({ success: true }),
    );

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({
      title: "Partial Success",
      description: `Deleted 1 of 2 event(s). 1 failed: ${reason}`,
      variant: "info",
    });
    await waitFor(() =>
      expect(screen.queryByTestId("row-event-1")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("row-event-2")).toBeInTheDocument();
  });

  it("is an error when nothing was deleted", async () => {
    await deleteTwo(() => Promise.reject(trpcError("Not allowed")));

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      errorToast("Failed to delete 2 event(s): Not allowed"),
    );
    expect(screen.getByTestId("row-event-1")).toBeInTheDocument();
    expect(screen.getByTestId("row-event-2")).toBeInTheDocument();
  });

  it("still deletes one at a time", async () => {
    let inFlight = 0;
    let most = 0;
    await deleteTwo(async () => {
      most = Math.max(most, ++inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { success: true };
    });

    expect(most).toBe(1);
    expect(mockServer.delete).toHaveBeenCalledTimes(2);
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({
      title: "Success",
      description: "Successfully deleted 2 event(s).",
      variant: "success",
    });
  });
});

describe("bulk download", () => {
  async function downloadTwo() {
    const user = renderList([makeEvent(1), makeEvent(2)]);
    await user.click(rowButton("event-1", "Select"));
    await user.click(rowButton("event-2", "Select"));
    await user.click(screen.getByTitle("Download selected events"));
    await waitForToast();
  }

  // jsdom can't make an object URL or follow the link to one.
  function stubSaving() {
    window.URL.createObjectURL = jest.fn(() => "blob:test");
    window.URL.revokeObjectURL = jest.fn();
    return jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the server's reason", async () => {
    mockServer.download.mockRejectedValue(
      trpcError("No authorized events found"),
    );

    await downloadTwo();

    expect(mockToast).toHaveBeenCalledWith(
      errorToast("No authorized events found"),
    );
  });

  it("says so when the server left an event out of the file", async () => {
    const save = stubSaving();
    mockServer.download.mockResolvedValue({
      format: "json",
      filename: "event-1.json",
      eventCount: 1,
      data: "{}",
    });

    await downloadTwo();

    expect(save).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({
      title: "Partial Success",
      description: "Downloaded 1 of 2 event(s). 1 no longer available.",
      variant: "info",
    });
  });

  it("says it worked when the file has everything", async () => {
    stubSaving();
    mockServer.download.mockResolvedValue({
      format: "json",
      filename: "events.json",
      eventCount: 2,
      data: "[]",
    });

    await downloadTwo();

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({
      title: "Success",
      description: "Successfully downloaded 2 event(s).",
      variant: "info",
    });
  });
});
