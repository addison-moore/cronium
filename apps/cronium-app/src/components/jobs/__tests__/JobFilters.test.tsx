/**
 * The jobs page's filter controls. They write the filters into the address, and
 * the page reads them back from it (see the page's own test), so what's tested
 * here is the address each control leads to, and that the controls start from the
 * filters the page hands them rather than from "all" whatever the list shows.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobFilters } from "../JobFilters";

const mockPush = jest.fn();
const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

// Radix Select asks the browser for these, and jsdom doesn't have them.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  mockPush.mockClear();
  mockRefresh.mockClear();
});

const searchBox = () => screen.getByRole("textbox", { name: "Search" });
const statusSelect = () => screen.getByRole("combobox", { name: "Status" });
const typeSelect = () => screen.getByRole("combobox", { name: "Type" });

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  select: HTMLElement,
  name: string,
) {
  await user.click(select);
  await user.click(await screen.findByRole("option", { name }));
}

describe("JobFilters", () => {
  it("starts from the filters the page hands it", () => {
    render(
      <JobFilters
        initial={{ search: "job_ab", status: "timed_out", type: "workflow" }}
      />,
    );

    expect(searchBox()).toHaveValue("job_ab");
    expect(statusSelect()).toHaveTextContent("Timed out");
    expect(typeSelect()).toHaveTextContent("Workflow");
  });

  it("starts with nothing filtered without them", () => {
    render(<JobFilters />);

    expect(searchBox()).toHaveValue("");
    expect(statusSelect()).toHaveTextContent("All statuses");
    expect(typeSelect()).toHaveTextContent("All types");
  });

  it("goes to the address of what's chosen on Apply Filters", async () => {
    const user = userEvent.setup();
    render(<JobFilters />);

    await choose(user, statusSelect(), "Failed");
    await choose(user, typeSelect(), "Tool Action");
    await user.type(searchBox(), "  job_x ");
    await user.click(screen.getByRole("button", { name: "Apply Filters" }));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      "/dashboard/jobs?status=failed&type=tool&search=job_x",
    );
  });

  it("goes to the bare page on Apply Filters with nothing chosen", async () => {
    const user = userEvent.setup();
    render(
      <JobFilters initial={{ search: "7", status: "all", type: "all" }} />,
    );

    await user.clear(searchBox());
    await user.click(screen.getByRole("button", { name: "Apply Filters" }));

    expect(mockPush).toHaveBeenCalledWith("/dashboard/jobs");
  });

  it("applies the search on Enter as well", async () => {
    const user = userEvent.setup();
    render(
      <JobFilters initial={{ search: "", status: "running", type: "all" }} />,
    );

    await user.type(searchBox(), "42{Enter}");

    expect(mockPush).toHaveBeenCalledWith(
      "/dashboard/jobs?status=running&search=42",
    );
  });

  it("doesn't apply on an Enter that an input method uses to pick characters", () => {
    render(<JobFilters />);

    fireEvent.keyDown(searchBox(), { key: "Enter", isComposing: true });
    expect(mockPush).not.toHaveBeenCalled();

    // The same key once the text is composed.
    fireEvent.keyDown(searchBox(), { key: "Enter" });
    expect(mockPush).toHaveBeenCalledWith("/dashboard/jobs");
  });

  it("clears every control and goes to the bare page on Reset", async () => {
    const user = userEvent.setup();
    render(
      <JobFilters
        initial={{ search: "job_ab", status: "failed", type: "http" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(mockPush).toHaveBeenCalledWith("/dashboard/jobs");
    expect(searchBox()).toHaveValue("");
    expect(statusSelect()).toHaveTextContent("All statuses");
    expect(typeSelect()).toHaveTextContent("All types");
  });

  it("refreshes the list on Refresh, keeping the address", async () => {
    const user = userEvent.setup();
    render(<JobFilters />);

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("offers every job status and type", async () => {
    const user = userEvent.setup();
    render(<JobFilters />);

    const optionsOf = async (select: HTMLElement) => {
      await user.click(select);
      const names = within(await screen.findByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent);
      await user.keyboard("{Escape}");
      return names;
    };

    expect(await optionsOf(statusSelect())).toEqual([
      "All statuses",
      "Queued",
      "Claimed",
      "Running",
      "Completed",
      "Failed",
      "Timed out",
      "Cancelled",
    ]);
    expect(await optionsOf(typeSelect())).toEqual([
      "All types",
      "Script",
      "HTTP",
      "Tool Action",
      "Workflow",
    ]);
  });
});
