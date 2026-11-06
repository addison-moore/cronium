/**
 * Who a row belongs to depends on who's looking, and the table doesn't know that
 * until the session answers. Until then a row mustn't claim to be someone else's,
 * or offer owners a Fork of their own event in place of their real actions.
 *
 * The real table and menu, with only useAuth stubbed: its states are the subject.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/hooks/useAuth";
import { EventStatus, EventType } from "@/shared/schema";
import { EventsTable } from "../events-table";
import type { Event } from "../types";

jest.mock("@/hooks/useAuth", () => ({ useAuth: jest.fn() }));

const VIEWER = "user-viewer";
const OTHER = "user-other";

const OWNER_ACTIONS = [
  "View Details",
  "Edit Event",
  "Duplicate",
  "Archive",
  "Delete",
];
const SHARED_ACTIONS = ["View Details", "Fork"];

function makeEvent(id: number, name: string, userId: string): Event {
  return {
    id,
    name,
    userId,
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
  };
}

function mockAuth(auth: {
  user: { id: string } | null;
  session: { user: { id: string } } | null | undefined;
}) {
  jest.mocked(useAuth).mockReturnValue(auth as ReturnType<typeof useAuth>);
}

function table() {
  return (
    <EventsTable
      events={[makeEvent(1, "mine", VIEWER), makeEvent(2, "theirs", OTHER)]}
      servers={[]}
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
    />
  );
}

function row(name: string): HTMLElement {
  return screen.getByRole("link", { name }).closest("tr")!;
}

function hasShareIcon(name: string): boolean {
  return row(name).querySelector("svg.lucide-share-2") !== null;
}

/** Opens the row's menu, reads what it offers, and closes it again. */
async function menuOf(name: string): Promise<string[]> {
  const user = userEvent.setup();
  await user.click(
    within(row(name)).getByRole("button", { name: "Open menu" }),
  );
  const items = screen
    .getAllByRole("menuitem")
    .map((item) => item.textContent ?? "");
  await user.keyboard("{Escape}");
  return items;
}

describe("EventsTable before it knows who's looking", () => {
  // useSession gives undefined while it's loading and null once it's signed out.
  describe.each([
    ["the session is loading", { user: null, session: undefined }],
    ["there's no session", { user: null, session: null }],
  ])("when %s", (_label, auth) => {
    beforeEach(() => {
      mockAuth(auth);
    });

    it("doesn't mark any row as someone else's", () => {
      render(table());

      expect(hasShareIcon("mine")).toBe(false);
      expect(hasShareIcon("theirs")).toBe(false);
    });

    it("offers only View Details, on any row", async () => {
      render(table());

      expect(await menuOf("mine")).toEqual(["View Details"]);
      expect(await menuOf("theirs")).toEqual(["View Details"]);
    });
  });
});

describe("EventsTable once it knows who's looking", () => {
  describe.each([
    [
      "the session has answered and getCurrentUser hasn't, or failed",
      { user: null, session: { user: { id: VIEWER } } },
    ],
    [
      "getCurrentUser has answered too",
      { user: { id: VIEWER }, session: { user: { id: VIEWER } } },
    ],
  ])("when %s", (_label, auth) => {
    beforeEach(() => {
      mockAuth(auth);
    });

    it("marks only someone else's row as shared", () => {
      render(table());

      expect(hasShareIcon("mine")).toBe(false);
      expect(hasShareIcon("theirs")).toBe(true);
    });

    it("gives owners their actions and everyone else Fork", async () => {
      render(table());

      expect(await menuOf("mine")).toEqual(OWNER_ACTIONS);
      expect(await menuOf("theirs")).toEqual(SHARED_ACTIONS);
    });
  });

  it("goes from no labels to the right ones when the session answers", async () => {
    mockAuth({ user: null, session: undefined });
    const { rerender } = render(table());
    expect(await menuOf("mine")).toEqual(["View Details"]);

    mockAuth({ user: null, session: { user: { id: VIEWER } } });
    rerender(table());

    expect(await menuOf("mine")).toEqual(OWNER_ACTIONS);
    expect(hasShareIcon("theirs")).toBe(true);
  });
});
