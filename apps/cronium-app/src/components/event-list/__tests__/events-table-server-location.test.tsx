/**
 * The Server column for an event with no servers. A script that runs only on
 * servers isn't local, but someone else's shared event comes with its servers
 * left out, so only its owner can be told it has none.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { useAuth } from "@/hooks/useAuth";
import { EventStatus, EventType, RunLocation } from "@/shared/schema";
import { EventsTable } from "../events-table";
import type { Event } from "../types";

jest.mock("@/hooks/useAuth", () => ({ useAuth: jest.fn() }));

const VIEWER = "user-viewer";
const OTHER = "user-other";

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: 1,
    name: "the event",
    userId: VIEWER,
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
    ...overrides,
  } as Event;
}

function locationOf(event: Event): string {
  render(
    <EventsTable
      events={[event]}
      servers={[{ id: 5, name: "web-1" } as never]}
      selectedEvents={new Set()}
      onSelectedEventsChange={jest.fn()}
      onEventRun={jest.fn()}
      onEventDuplicate={jest.fn()}
      onEventFork={jest.fn()}
      onEventStatusChange={jest.fn()}
      onEventDelete={jest.fn()}
      isRunning={{}}
      isLoading={false}
      searchTerm=""
    />,
  );
  const row = screen.getByText("the event").closest("tr")!;
  const cells = within(row).getAllByRole("cell");
  const headers = screen.getAllByRole("columnheader");
  const column = headers.findIndex((header) =>
    header.textContent?.includes("Server"),
  );
  return cells[column]!.textContent!.trim();
}

beforeEach(() => {
  jest
    .mocked(useAuth)
    .mockReturnValue({ user: { id: VIEWER } } as ReturnType<typeof useAuth>);
});

describe("the Server column", () => {
  it("says a REMOTE script with no servers has none", () => {
    expect(locationOf(makeEvent({ runLocation: RunLocation.REMOTE }))).toBe(
      "no servers",
    );
  });

  it("says it from the session when getCurrentUser failed, which isn't retried", () => {
    jest.mocked(useAuth).mockReturnValue({
      user: null,
      session: { user: { id: VIEWER } },
    } as ReturnType<typeof useAuth>);

    expect(locationOf(makeEvent({ runLocation: RunLocation.REMOTE }))).toBe(
      "no servers",
    );
  });

  it("doesn't say it until it knows who's looking", () => {
    jest.mocked(useAuth).mockReturnValue({
      user: null,
      session: undefined,
    } as unknown as ReturnType<typeof useAuth>);

    expect(locationOf(makeEvent({ runLocation: RunLocation.REMOTE }))).not.toBe(
      "no servers",
    );
  });

  it("doesn't say that of someone else's event, whose servers are left out", () => {
    expect(
      locationOf(makeEvent({ runLocation: RunLocation.REMOTE, userId: OTHER })),
    ).not.toBe("no servers");
  });

  it("names the server of a REMOTE script that has one", () => {
    expect(
      locationOf(
        makeEvent({ runLocation: RunLocation.REMOTE, eventServers: [5] }),
      ),
    ).toBe("web-1");
  });

  it.each([
    ["a LOCAL script", { runLocation: RunLocation.LOCAL }],
    [
      "a LOCAL_AND_REMOTE script with no servers",
      { runLocation: RunLocation.LOCAL_AND_REMOTE },
    ],
    [
      "a REMOTE HTTP request, which runs in the worker",
      { runLocation: RunLocation.REMOTE, type: EventType.HTTP_REQUEST },
    ],
    [
      "a REMOTE tool action, which runs in the worker",
      { runLocation: RunLocation.REMOTE, type: EventType.TOOL_ACTION },
    ],
  ])("says local for %s", (_name, fields) => {
    expect(locationOf(makeEvent(fields))).toBe("local");
  });
});
