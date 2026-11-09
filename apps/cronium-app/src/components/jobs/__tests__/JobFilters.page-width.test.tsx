/**
 * The jobs page has to fit a tablet. Its filters sat in four equal columns from
 * md, and with the sidebar open a quarter of the row is narrower than Apply
 * Filters and Reset side by side (196 px) until the window is about 1190 px wide:
 * 91 px at 768 px, which made the page 823 px wide with Reset off the screen, and
 * 155 px at 1024 px, which put Reset past both cards. Below xl there are now two
 * columns, and from xl the same four as before.
 *
 * jsdom has no layout, so this pins the rule rather than the pixels.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { JobFilters } from "../JobFilters";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

const COLUMNS = /^(?:([a-z0-9]+):)?grid-cols-(\d+)$/;

describe("what can't widen the jobs page", () => {
  it("uses four columns only from xl, with Apply Filters and Reset in one of them", () => {
    render(<JobFilters />);

    const grid = screen
      .getByPlaceholderText("Job ID or Event ID")
      .closest(".grid")!;
    const columns = [...grid.classList].flatMap((name) => {
      const match = COLUMNS.exec(name);
      return match
        ? [{ at: match[1] ?? "any width", count: Number(match[2]) }]
        : [];
    });

    expect(
      columns.filter(
        ({ at, count }) => count > 2 && at !== "xl" && at !== "2xl",
      ),
    ).toEqual([]);
    expect(columns).toContainEqual({ at: "xl", count: 4 });

    const apply = screen.getByRole("button", { name: "Apply Filters" });
    const reset = screen.getByRole("button", { name: "Reset" });
    expect(apply.parentElement).toBe(reset.parentElement);
    expect(apply.parentElement!.parentElement).toBe(grid);
  });
});
