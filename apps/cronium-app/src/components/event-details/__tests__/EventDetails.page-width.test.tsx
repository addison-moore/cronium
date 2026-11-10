/**
 * The rest of an event's page that a long name, or a narrow screen, pushed past
 * its edge, once the header stopped doing it (see
 * EventDetailsHeader.page-width.test.tsx). Measured on a production build at
 * 320 px:
 * - the Overview's Event Name row ran a 240-character name with no spaces 1900 px
 *   past its card, and the page with it;
 * - the Delete dialog's column grew to that name, so Cancel and Delete sat 2000 px
 *   off the screen, and on a phone the dialog couldn't be closed;
 * - the loading skeleton's header made the page 568 px wide, whatever the name.
 *
 * jsdom has no layout, so these pin what rules each cause out rather than the pixels.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { EventStatus, EventType } from "@/shared/schema";
import { EventOverviewTab } from "../EventOverviewTab";
import { EventDeleteDialog } from "../EventDeleteDialog";
import { EventDetailsSkeleton } from "../EventDetailsSkeleton";
import type { Event } from "../types";

jest.mock("../WorkflowsCard", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../ScheduleIncidentsCard", () => ({
  ScheduleIncidentsCard: () => null,
}));

const unbroken = "longeventname".repeat(19).slice(0, 240);

const FLEX_CONTAINER = /(^|\s)flex(\s|$)/;
const CAN_SHRINK = /(^|\s)(min-w-0|overflow-hidden)(\s|$)/;

describe("what else can't widen an event's page", () => {
  it("breaks a name with nowhere to break on the Overview, inside its card", () => {
    render(
      <EventOverviewTab
        event={
          {
            id: 7,
            name: unbroken,
            type: EventType.BASH,
            status: EventStatus.ACTIVE,
            content: "echo hello",
            scheduleNumber: 1,
            scheduleUnit: "MINUTES",
            customSchedule: null,
            timeoutValue: 30,
            timeoutUnit: "SECONDS",
            retries: 0,
            runLocation: "LOCAL",
            createdAt: "2026-11-01T00:00:00.000Z",
            updatedAt: "2026-11-01T00:00:00.000Z",
            lastRunAt: null,
            nextRunAt: null,
            servers: [],
          } as unknown as Event
        }
        onResetCounter={jest.fn()}
        isResettingCounter={false}
      />,
    );

    const value = screen.getByText(unbroken);
    expect(value).toHaveClass("break-words");
    // `break-words` breaks a word where it meets the edge of its box, so that box
    // has to get its width from the card, not from the name. A flex container
    // anywhere on the way up would size it to the whole name instead, and the
    // cards' grid has to have columns that can't grow either.
    let at = value.parentElement!;
    const flexOnTheWay: string[] = [];
    while (!/(^|\s)grid(\s|$)/.test(at.className)) {
      if (FLEX_CONTAINER.test(at.className)) flexOnTheWay.push(at.className);
      at = at.parentElement!;
    }
    expect(flexOnTheWay).toEqual([]);
    expect(at).toHaveClass("grid-cols-1", "md:grid-cols-2");
  });

  it("breaks the name in the Delete dialog, so Cancel and Delete stay on the screen", () => {
    render(
      <EventDeleteDialog
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        isDeleting={false}
        eventName={unbroken}
      />,
    );

    // The dialog is a grid with one column, which grows to its longest word unless
    // that word can break anywhere.
    expect(screen.getByText(unbroken)).toHaveClass("wrap-anywhere");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("lets the loading skeleton's header fit a phone", () => {
    const { container } = render(<EventDetailsSkeleton />);

    const nameBar = container.querySelector(".w-64")!;
    const row = nameBar.closest(".mb-6")!;
    // The button bars go under the name's when both don't fit on one line.
    expect(row).toHaveClass("flex", "flex-wrap");
    // And the name's bar narrows, which every flex item around it has to allow.
    expect(nameBar).toHaveClass("max-w-full");
    const blocking: string[] = [];
    for (let at = nameBar.parentElement!; at !== row; at = at.parentElement!) {
      if (
        FLEX_CONTAINER.test(at.parentElement!.className) &&
        !CAN_SHRINK.test(at.className)
      ) {
        blocking.push(at.className);
      }
    }
    expect(blocking).toEqual([]);
    // The back button's square keeps its size beside a bar that shrinks.
    expect(row.querySelector(".h-8.w-8")).toHaveClass("shrink-0");
  });
});
