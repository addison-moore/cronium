/**
 * The session provider belongs to the dashboard. At the root it fetches the session on every
 * page, and when that answer beats the page's own chunk, React throws away the server HTML it
 * hasn't hydrated yet. On the sign-in page that lost what was typed and any press before
 * hydration, on most loads over a slow connection.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { useSession } from "next-auth/react";
import { Providers } from "@/components/providers/Providers";
import DashboardLayout from "@/app/dashboard/layout";

jest.mock("@/app/dashboard/layout-client", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/lib/auth-cache", () => ({
  getCachedServerSession: () =>
    Promise.resolve({ user: { id: "user-1", email: "ada@example.com" } }),
}));

const sessionFetches = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("/session"));

describe("where the session is fetched", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    // jsdom has no Response. next-auth only reads these two.
    fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            user: { id: "user-1" },
            expires: "2099-01-01T00:00:00Z",
          }),
      }),
    );
    globalThis.fetch = fetchMock;
  });

  it("isn't done by the providers every page gets", async () => {
    render(
      <Providers>
        <p>a page</p>
      </Providers>,
    );

    expect(screen.getByText("a page")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sessionFetches(fetchMock)).toEqual([]);
  });

  it("is done for the dashboard, whose pages read it", async () => {
    function ReadsTheSession() {
      const { status, data } = useSession();
      return (
        <p>
          {status} {data?.user?.id}
        </p>
      );
    }

    render(await DashboardLayout({ children: <ReadsTheSession /> }));

    await waitFor(() =>
      expect(screen.getByText(/authenticated/)).toBeInTheDocument(),
    );
    expect(sessionFetches(fetchMock)).toHaveLength(1);
  });
});
