/**
 * At 320 px the events page's sort direction button sat past its column and 15 px
 * past the filter card, because the select beside it can't get narrower than its
 * label. The two now wrap: the button goes under the select where the column has
 * no room for both, and stays beside it everywhere else.
 *
 * jsdom has no layout, so this pins the rule rather than the pixels.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { EventsFilters } from "../events-filters";

describe("what can't push the events filters past their card", () => {
  it("wraps the sort direction button under the select, and never cuts the select's label", () => {
    render(
      <EventsFilters
        filters={{
          searchTerm: "",
          typeFilter: "all",
          statusFilter: "all",
          serverFilter: "all",
          tagFilter: "all",
          workflowFilter: "all",
          sortBy: "name",
          sortOrder: "desc",
        }}
        onFiltersChange={jest.fn()}
        onClearFilters={jest.fn()}
        events={[]}
        servers={[]}
        workflows={[]}
      />,
    );

    const direction = screen.getByTitle("Sort Descending");
    const row = direction.parentElement!;
    const select = within(row).getByRole("combobox");

    expect(row).toHaveClass("flex", "flex-wrap");
    // `flex-1` gives the select a flex basis of 0, so the row only breaks when its
    // label leaves no room. With `w-full` alone it would take the whole row and the
    // button would wrap at every width.
    expect(select).toHaveClass("flex-1");
    // A select that could shrink would clip its label instead.
    expect(select).not.toHaveClass("min-w-0");
    expect(direction).toHaveClass("shrink-0");
  });
});
