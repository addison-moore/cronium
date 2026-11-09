/**
 * The scheduling banner shows when the worker is down, which is when someone most needs to
 * get around. It used to come first in the page with a z-index above the fixed header and
 * sidebar, so it covered them: at phone width a press on the menu button landed on the banner.
 *
 * jsdom has no layout, so these pin what rules that out: the banner sits in the column that's
 * already offset from the fixed chrome, and nothing lifts it back over them as the page scrolls.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { UserRole } from "@/shared/schema";
import type { User } from "next-auth";
import DashboardLayoutClient from "../layout-client";

jest.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ permissions: { console: false } }),
}));

const user = {
  id: "user-1",
  email: "someone@example.test",
  role: UserRole.USER,
} as unknown as User;

const mockFetch = jest.fn();

function answerHealth(scheduler: { healthy: boolean; neverSeen?: boolean }) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ status: "ok", scheduler }),
  });
}

function renderLayout() {
  render(
    <DashboardLayoutClient user={user}>
      <p>The page</p>
    </DashboardLayoutClient>,
  );
  return screen.getByRole("main");
}

describe("the scheduling banner in the dashboard layout", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
  });

  it("sits directly above the page, in the column offset from the header and sidebar", async () => {
    answerHealth({ healthy: false, neverSeen: true });
    const main = renderLayout();

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Scheduling is offline");
    expect(banner.nextElementSibling).toBe(main);
    expect(banner.parentElement).toHaveClass("pt-16", "md:pl-64");
  });

  it("isn't positioned or stacked, so it scrolls under the fixed header", async () => {
    answerHealth({ healthy: false });
    renderLayout();

    const banner = await screen.findByRole("alert");
    expect(banner.className).not.toMatch(
      /(^|\s)(relative|absolute|fixed|sticky|z-\S+)(\s|$)/,
    );
  });

  it("leaves nothing above the page while the worker is healthy", async () => {
    answerHealth({ healthy: true });
    const main = renderLayout();

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    // Give the answer time to reach the banner, which would show by now if it were going to
    await act(() => new Promise((resolve) => setTimeout(resolve)));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(main.previousElementSibling).toBeNull();
  });
});
