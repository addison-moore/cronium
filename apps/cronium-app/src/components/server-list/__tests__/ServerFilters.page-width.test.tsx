/**
 * The servers page has to fit a 320 px phone. There the filter row is 254 px wide,
 * inside the page's padding and the card's, and the search box had
 * `min-w-[300px]`, so the page was 333 px wide with the end of the search box past
 * the screen's edge. Its minimum is now 300 px or the whole row, whichever is less.
 *
 * jsdom has no layout, so this pins the rule rather than the pixels.
 */
import React from "react";
import { render } from "@testing-library/react";
import { ServerFilters } from "../ServerFilters";

// 320 px less the dashboard's `p-4` each side, then the card's border and `p-4` each side.
const PHONE_ROW_WIDTH = 320 - 2 * 16 - 2 * (1 + 16);
const FIXED_WIDTH = /^(?:min-w|w|basis)-\[(\d+(?:\.\d+)?)px\]$/;

describe("what can't widen the servers page", () => {
  it("has no fixed width in the filter row wider than a 320 px phone's row", () => {
    const { container } = render(
      <ServerFilters
        filters={{
          searchTerm: "",
          statusFilter: "all",
          groupFilter: "all",
          sortBy: "name",
          sortOrder: "asc",
        }}
        groups={[{ id: 1, name: "rig-group" }]}
        onFiltersChange={jest.fn()}
        onClearFilters={jest.fn()}
      />,
    );

    const tooWide = [...container.querySelectorAll("*")].flatMap((element) =>
      [...element.classList].filter((name) => {
        const width = FIXED_WIDTH.exec(name)?.[1];
        return width !== undefined && Number(width) > PHONE_ROW_WIDTH;
      }),
    );

    expect(PHONE_ROW_WIDTH).toBe(254);
    expect(tooWide).toEqual([]);
    // Wider rows keep the 300 px floor, so nothing moves on a desktop.
    expect(
      container.querySelector('input[placeholder="Search servers..."]')!
        .parentElement,
    ).toHaveClass("min-w-[min(300px,100%)]", "flex-1");
  });
});
