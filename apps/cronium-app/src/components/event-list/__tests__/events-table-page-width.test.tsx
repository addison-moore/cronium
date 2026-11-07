/**
 * The events page has to fit a phone, or the fixed header's theme and menu buttons
 * end up past the screen's edge. A table too wide for the screen scrolls inside its
 * own frame, and nothing else may make the page wider. Four things did:
 *
 * - Row labels such as "Run Event" and "Open menu" are `sr-only`, so `position:
 *   absolute`. An absolutely positioned element is only clipped by a scrolling
 *   ancestor at or inside its containing block, and the frame wasn't positioned, so
 *   the labels past its edge widened the document: 660 px at 375 px.
 * - The loading skeleton's header bars have fixed widths: 834 px at 375 px.
 * - The row of pagination buttons couldn't wrap: 329 px at 320 px.
 * - Nor could the bulk actions row, which ran past the screen at 320 px.
 *
 * jsdom has no layout, so these pin what rules each one out rather than the pixels.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import {
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableSkeleton,
} from "@cronium/ui";
import { useAuth } from "@/hooks/useAuth";
import { EventStatus, EventType } from "@/shared/schema";
import { BulkActionsToolbar } from "../bulk-actions-toolbar";
import { EventsTable } from "../events-table";
import type { Event } from "../types";

jest.mock("@/hooks/useAuth", () => ({ useAuth: jest.fn() }));

const event: Event = {
  id: 1,
  name: "nightly backup",
  userId: "user-1",
  description: null,
  type: EventType.BASH,
  status: EventStatus.ACTIVE,
  content: "echo hi",
  scheduleNumber: 1,
  scheduleUnit: "MINUTES",
  customSchedule: null,
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
  lastRunAt: null,
  nextRunAt: null,
};

const hasClass = (element: Element, pattern: RegExp): boolean =>
  pattern.test(element.className);
const POSITIONED = /(^|\s)(relative|absolute|fixed|sticky)(\s|$)/;
const CLIPS = /(^|\s)overflow(-x)?-(auto|scroll|hidden|clip)(\s|$)/;

/** What clips an absolutely positioned element, or null if it escapes them all. */
function clipOfAbsolute(element: Element): Element | null {
  let foundBlock = false;
  for (let at = element.parentElement; at; at = at.parentElement) {
    foundBlock ||= hasClass(at, POSITIONED);
    if (hasClass(at, CLIPS)) return foundBlock ? at : null;
  }
  return null;
}

describe("what can't widen the events page", () => {
  it("clips the rows' screen reader labels in the table's own frame", () => {
    jest.mocked(useAuth).mockReturnValue({
      user: { id: "user-1" },
      session: { user: { id: "user-1" } },
    } as ReturnType<typeof useAuth>);

    render(
      <EventsTable
        events={[event]}
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
      />,
    );

    const frame = screen.getByRole("table").parentElement;

    for (const text of ["Run Event", "Open menu"]) {
      const label = screen.getByText(text);
      expect(label).toHaveClass("sr-only");
      expect(clipOfAbsolute(label)).toBe(frame);
    }
  });

  it("clips anything absolute in any shared table's cell the same way", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>
              <span className="absolute">past the edge</span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(clipOfAbsolute(screen.getByText("past the edge"))).toBe(
      screen.getByRole("table").parentElement,
    );
  });

  it("clips the loading skeleton's header, whose bars can't shrink", () => {
    const { container } = render(<TableSkeleton columns={6} showActions />);

    const headerBar = container.querySelector(".w-24.h-4");

    expect(headerBar).not.toBeNull();
    expect(headerBar!.closest(".overflow-hidden")).not.toBeNull();
  });

  it("lets the pagination buttons wrap under the count", () => {
    render(
      <Pagination
        currentPage={1}
        totalPages={3}
        onPageChange={jest.fn()}
        itemsPerPage={20}
        totalItems={50}
      />,
    );

    const row = screen.getByText(/Showing 1 to 20 of 50/).parentElement!;

    expect(row).toHaveClass("flex-wrap");
    // A column gap would widen the row where it does fit, and move the count at desktop.
    expect(row).not.toHaveClass("gap-2");
    expect(row).not.toHaveClass("gap-x-2");
  });

  it("lets the bulk actions wrap under the count, with all of them still there", () => {
    render(
      <BulkActionsToolbar
        selectedCount={2}
        bulkActionLoading={null}
        onBulkActivate={jest.fn()}
        onBulkPause={jest.fn()}
        onBulkDownload={jest.fn()}
        onBulkArchive={jest.fn()}
        onBulkDelete={jest.fn()}
        onClearSelection={jest.fn()}
      />,
    );

    const count = screen.getByText("2 event(s) selected");
    const row = count.parentElement!.parentElement!;

    expect(row).toHaveClass("flex-wrap");
    expect(row.querySelectorAll("button")).toHaveLength(6);
  });
});
