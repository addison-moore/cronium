/**
 * An event's page has to fit a phone, or the fixed header's theme and menu
 * buttons end up past the screen's edge, where nobody can press them. A long name
 * widened it on every tab and at any width: an 86-character one made the page
 * 919 px wide at 320 and 375 px and 1299 px at 1280 px, and one of 240 characters
 * with no spaces made it 2914 px at 320 px. The heading's `truncate` only cuts
 * text in a box that can get narrower than the text, and no flex item around it
 * could.
 *
 * jsdom has no layout, so these pin what rules the cause out rather than the pixels.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { EventStatus, EventType } from "@/shared/schema";
import { EventDetailsHeader } from "../EventDetailsHeader";
import type { Event } from "../types";

const name =
  "A long event name with plenty of spaces in it that wraps inside its own cell if it can";

function eventOfType(type: EventType) {
  return {
    id: 5,
    name,
    type,
    status: EventStatus.PAUSED,
    content: "echo hello",
    scheduleNumber: 1,
    scheduleUnit: "MINUTES",
    customSchedule: null,
    runLocation: "LOCAL",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    lastRunAt: null,
    nextRunAt: null,
  } as unknown as Event;
}

const FLEX_CONTAINER = /(^|\s)flex(\s|$)/;
// `truncate` and `overflow-hidden` count: a box that clips has no content-based minimum width.
const CAN_SHRINK =
  /(^|\s)(min-w-0|truncate|overflow-hidden|overflow-x-hidden)(\s|$)/;

function renderHeader(type: EventType = EventType.BASH) {
  render(
    <EventDetailsHeader
      event={eventOfType(type)}
      onDelete={jest.fn()}
      onRun={jest.fn()}
      onStatusChange={jest.fn()}
      isRunning={false}
    />,
  );
  const heading = screen.getByRole("heading", { name });
  const deleteButton = screen.getByRole("button", { name: "Delete" });
  let row = heading.parentElement!;
  while (!row.contains(deleteButton)) row = row.parentElement!;
  return { heading, row };
}

describe("what can't widen an event's page", () => {
  it("lets a long name truncate, so it can't push the page past the screen", () => {
    const { heading, row } = renderHeader();

    expect(heading).toHaveClass("truncate");
    // Every flex item from the heading up to the header row has to be able to get
    // narrower than the name, or `truncate` never gets a box to cut the text in.
    const blocking: string[] = [];
    for (let at: HTMLElement = heading; at !== row; at = at.parentElement!) {
      const inFlexRow = FLEX_CONTAINER.test(at.parentElement!.className);
      if (inFlexRow && !CAN_SHRINK.test(at.className)) {
        blocking.push(`<${at.tagName.toLowerCase()} class="${at.className}">`);
      }
    }
    expect(blocking).toEqual([]);
  });

  it("keeps Run Now, Delete and the status menu beside the name", () => {
    const { heading, row } = renderHeader();

    expect(row).toContainElement(
      screen.getByRole("button", { name: "Run Now" }),
    );
    expect(row).toContainElement(
      screen.getByRole("button", { name: "Delete" }),
    );
    expect(heading.parentElement!.nextElementSibling).toHaveTextContent(
      "Paused",
    );
  });

  it("leaves the shrinking to the name, so Run Now and Delete stay on one line", () => {
    renderHeader();

    // From lg the buttons share the name's row. If they could shrink too, a long
    // name took some of their room and they wrapped into a column, at 1024 to
    // 1440 px for a name of 240 characters.
    const runNow = screen.getByRole("button", { name: "Run Now" });
    expect(runNow.parentElement).toContainElement(
      screen.getByRole("button", { name: "Delete" }),
    );
    expect(runNow.parentElement).toHaveClass("shrink-0");
  });

  // Once the row can shrink, so can the icon beside the name, down to a sliver,
  // unless it's told not to. Each event type draws a different element there.
  it.each([
    EventType.BASH,
    EventType.PYTHON,
    EventType.NODEJS,
    EventType.HTTP_REQUEST,
    EventType.TOOL_ACTION,
  ])("keeps the %s icon beside the name at its size", (type) => {
    const { heading } = renderHeader(type);

    expect(heading.previousElementSibling).toHaveClass("shrink-0");
  });
});
