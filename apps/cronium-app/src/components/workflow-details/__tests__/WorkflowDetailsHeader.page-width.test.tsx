/**
 * A workflow's page has to fit a phone, or the fixed header's theme and menu
 * buttons end up past the screen's edge, where nobody can press them. The header
 * row kept the name, Run Now and Delete side by side with no way to wrap, so the
 * page was 399 px wide at 320 and 375 px, and 840 px at 768 px with the sidebar
 * open, on every tab. A long name widened it at any width, to 1513 px at 1440 px
 * for one of 86 characters: the heading's `truncate` only cuts text in a box that
 * can get narrower than the text, and no flex item around it could.
 *
 * jsdom has no layout, so these pin what rules each cause out rather than the pixels.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import {
  EventStatus,
  WorkflowTriggerType,
  type Workflow,
} from "@/shared/schema";
import { WorkflowDetailsHeader } from "../WorkflowDetailsHeader";

const name =
  "A long workflow name with plenty of spaces in it that could wrap if the heading let it";

const workflow = {
  id: 4,
  userId: "user-1",
  name,
  description: null,
  triggerType: WorkflowTriggerType.MANUAL,
  status: EventStatus.ACTIVE,
  shared: false,
  tags: [],
  createdAt: new Date("2026-11-01T00:00:00.000Z"),
  updatedAt: new Date("2026-11-01T00:00:00.000Z"),
} as unknown as Workflow;

const FLEX_CONTAINER = /(^|\s)flex(\s|$)/;
// `truncate` and `overflow-hidden` count: a box that clips has no content-based minimum width.
const CAN_SHRINK =
  /(^|\s)(min-w-0|truncate|overflow-hidden|overflow-x-hidden)(\s|$)/;

function renderHeader() {
  render(
    <WorkflowDetailsHeader
      workflow={workflow}
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

describe("what can't widen a workflow's page", () => {
  it("lets Run Now and Delete wrap under the name, with both still there", () => {
    const { row } = renderHeader();

    expect(row).toHaveClass("flex", "flex-wrap");
    expect(row).toContainElement(
      screen.getByRole("button", { name: "Run Now" }),
    );
    expect(row).toContainElement(
      screen.getByRole("link", { name: "Back to Workflows" }),
    );
  });

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
    // Once the row can shrink, so can the icon beside the name, down to a sliver
    // (4.5 px wide for an 86-character name at 320 px), unless it's told not to.
    expect(heading.previousElementSibling).toHaveClass("shrink-0");
  });
});
