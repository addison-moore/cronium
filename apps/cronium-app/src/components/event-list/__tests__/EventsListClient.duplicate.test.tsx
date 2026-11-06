/**
 * What Duplicate and Fork do once they've worked, or been refused: the input they
 * send, and whether the new row is fetched. The rows come from the page's server
 * component, so nothing else brings a new one in. What a failure says is in
 * EventsListClient.failures.test.tsx.
 *
 * The table is a stub because only the wiring from its callbacks is under test.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventStatus, EventType, RunLocation } from "@/shared/schema";
import type { Event } from "@/components/event-list";

const mockToast = jest.fn();
const mockRefresh = jest.fn();
const mockCreate = jest.fn();
const mockFork = jest.fn();

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

jest.mock("@/hooks/use-persistent-pagination", () => ({
  usePersistentPagination: () => ({
    itemsPerPage: 10,
    setItemsPerPage: jest.fn(),
  }),
}));

jest.mock("@/components/event-list", () => ({
  EventsFilters: () => null,
  BulkActionsToolbar: () => null,
  EventsTable: ({
    onEventDuplicate,
    onEventFork,
  }: {
    onEventDuplicate: (id: number) => void;
    onEventFork: (id: number) => void;
  }) => (
    <>
      <button onClick={() => onEventDuplicate(1)}>Duplicate</button>
      <button onClick={() => onEventFork(1)}>Fork</button>
    </>
  ),
}));

jest.mock("@/lib/trpc", () => {
  const idle = { useMutation: () => ({ mutateAsync: jest.fn() }) };
  return {
    trpc: {
      events: {
        delete: idle,
        execute: idle,
        update: idle,
        activate: idle,
        deactivate: idle,
        download: idle,
        create: {
          useMutation: () => ({
            mutateAsync: (input: unknown) => mockCreate(input) as unknown,
          }),
        },
        fork: {
          useMutation: () => ({
            mutateAsync: (input: unknown) => mockFork(input) as unknown,
          }),
        },
      },
    },
  };
});

import { EventsListClient } from "../EventsListClient";

const remoteEvent: Event = {
  id: 1,
  name: "Nightly job",
  userId: "user-1",
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
  runLocation: RunLocation.REMOTE,
  eventServers: [6, 7],
};

function renderList(props: { onRefresh?: () => void } = {}) {
  render(
    <EventsListClient
      initialEvents={[remoteEvent]}
      servers={[]}
      workflows={[]}
      {...props}
    />,
  );
}

async function click(name: string) {
  await userEvent.click(screen.getByRole("button", { name }));
}

describe("EventsListClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Duplicate", () => {
    it("sends the event's server links as selectedServerIds", async () => {
      mockCreate.mockResolvedValue({ id: 2 });
      renderList();

      await click("Duplicate");

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      const input = mockCreate.mock.calls[0]![0] as object;
      expect(input).toMatchObject({
        name: "Nightly job (copy)",
        status: EventStatus.DRAFT,
        runLocation: RunLocation.REMOTE,
        selectedServerIds: [6, 7],
      });
      expect(input).not.toHaveProperty("serverIds");
    });

    it("re-runs the server component so the copy appears", async () => {
      mockCreate.mockResolvedValue({ id: 2 });
      renderList();

      await click("Duplicate");

      await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    });

    it("doesn't refresh when it's refused", async () => {
      mockCreate.mockRejectedValue(new Error("Refused"));
      renderList();

      await click("Duplicate");

      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });

  describe("Fork", () => {
    it("re-runs the server component so the fork appears", async () => {
      mockFork.mockResolvedValue({ id: 3 });
      renderList();

      await click("Fork");

      await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    });

    it("doesn't refresh when it's refused", async () => {
      mockFork.mockRejectedValue(new Error("Refused"));
      renderList();

      await click("Fork");

      await waitFor(() => expect(mockFork).toHaveBeenCalledTimes(1));
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });

  it("leaves refreshing to onRefresh when it's given one", async () => {
    const onRefresh = jest.fn();
    mockCreate.mockResolvedValue({ id: 2 });
    renderList({ onRefresh });

    await click("Duplicate");

    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
