/**
 * The server page has to say when an action fails. There is no global mutation
 * error handler, so a mutation without its own handling looks like a click that
 * did nothing. The check on page load is the exception, and has to stay quiet: it's
 * refused on every view of a shared or archived server, and the page still shows
 * them.
 *
 * react-query is real, and errors are real TRPCClientErrors.
 */
import React, { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";

const mockToast = jest.fn();
const mockPush = jest.fn();
const mockInvalidate = jest.fn();
const mockServer = {
  checkHealth: jest.fn(),
  delete: jest.fn(),
};
const mockServerRow = {
  id: 7,
  name: "web-1",
  address: "10.0.0.7",
  username: "deploy",
  port: 22,
  online: true,
  lastChecked: new Date("2026-11-05T00:00:00.000Z"),
  createdAt: new Date("2026-11-01T00:00:00.000Z"),
  updatedAt: new Date("2026-11-01T00:00:00.000Z"),
};

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  toast: (...args: unknown[]): unknown => mockToast(...args),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/dashboard/servers/7",
}));

jest.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ permissions: { console: false } }),
}));
jest.mock("@/components/dashboard/ServerEventsList", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/dashboard/ServerForm", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/terminal/Terminal-lazy", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/lib/trpc", () => {
  const { useMutation } = jest.requireActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  const procedure = (name: keyof typeof mockServer) => ({
    useMutation: (options?: object) =>
      useMutation({
        mutationFn: (input: unknown): Promise<unknown> =>
          mockServer[name](input) as Promise<unknown>,
        ...options,
      }),
  });
  return {
    trpc: {
      useUtils: () => ({
        servers: { getById: { invalidate: mockInvalidate } },
      }),
      servers: {
        getById: {
          useQuery: () => ({
            data: mockServerRow,
            isLoading: false,
            refetch: jest.fn(),
          }),
        },
        checkHealth: procedure("checkHealth"),
        delete: procedure("delete"),
      },
    },
  };
});

import ServerDetailsPage from "../page";

function trpcError(message: string): TRPCClientError<never> {
  return TRPCClientError.from({
    error: {
      message,
      code: -32603,
      data: { code: "NOT_FOUND", httpStatus: 404, zodError: null },
    },
  });
}

async function renderPage() {
  const params = Promise.resolve({ id: "7" });
  await act(async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Suspense fallback={null}>
          <ServerDetailsPage params={params} />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  // The check on page load has settled once the button is back.
  await screen.findByRole("button", { name: "Check Status" });
  return userEvent.setup();
}

const healthy = {
  online: true,
  lastChecked: "2026-11-05T00:00:00.000Z",
  systemInfo: null,
};

const failureToast = (title: string, description: string) => ({
  title,
  description,
  variant: "destructive",
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe("Check Status", () => {
  it("shows the server's reason, once, when it's refused", async () => {
    mockServer.checkHealth.mockResolvedValueOnce(healthy);
    const user = await renderPage();
    mockServer.checkHealth.mockRejectedValueOnce(trpcError("Server not found"));

    await user.click(screen.getByRole("button", { name: "Check Status" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith(
      failureToast("Health Check Failed", "Server not found"),
    );
    await screen.findByRole("button", { name: "Check Status" });
  });

  it("still says something when the error has no message", async () => {
    mockServer.checkHealth.mockResolvedValueOnce(healthy);
    const user = await renderPage();
    mockServer.checkHealth.mockRejectedValueOnce(trpcError(""));

    await user.click(screen.getByRole("button", { name: "Check Status" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        failureToast(
          "Health Check Failed",
          "Failed to check the server. Please try again.",
        ),
      ),
    );
  });

  it("doesn't refresh the server's status as if it had worked", async () => {
    mockServer.checkHealth.mockResolvedValueOnce(healthy);
    const user = await renderPage();
    mockServer.checkHealth.mockRejectedValueOnce(trpcError("Server not found"));

    await user.click(screen.getByRole("button", { name: "Check Status" }));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it("reports the next check too", async () => {
    mockServer.checkHealth.mockResolvedValueOnce(healthy);
    const user = await renderPage();
    mockServer.checkHealth.mockRejectedValueOnce(trpcError("Server not found"));
    await user.click(screen.getByRole("button", { name: "Check Status" }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: "Check Status" });

    mockServer.checkHealth.mockResolvedValueOnce(healthy);
    await user.click(screen.getByRole("button", { name: "Check Status" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(2));
    expect(mockToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Server Online" }),
    );
  });
});

describe("the check on page load", () => {
  it("says nothing when it's refused", async () => {
    mockServer.checkHealth.mockRejectedValue(trpcError("Server not found"));

    await renderPage();
    await waitFor(() => expect(mockServer.checkHealth).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("doesn't turn the next press of the button quiet", async () => {
    mockServer.checkHealth.mockRejectedValueOnce(trpcError("Server not found"));
    const user = await renderPage();
    expect(mockToast).not.toHaveBeenCalled();

    mockServer.checkHealth.mockRejectedValueOnce(trpcError("Still not found"));
    await user.click(screen.getByRole("button", { name: "Check Status" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        failureToast("Health Check Failed", "Still not found"),
      ),
    );
    expect(mockToast).toHaveBeenCalledTimes(1);
  });
});

describe("Delete Server", () => {
  async function confirmDelete() {
    mockServer.checkHealth.mockResolvedValueOnce(healthy);
    const user = await renderPage();
    await user.click(screen.getByRole("button", { name: /Delete Server/ }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Delete",
    );
    await user.click(confirm!);
  }

  it("shows the server's reason, once, and stays on the page", async () => {
    mockServer.delete.mockRejectedValue(trpcError("Server not found"));

    await confirmDelete();

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith(
      failureToast("Deletion Failed", "Server not found"),
    );
    expect(mockPush).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("still goes back to the list when it works", async () => {
    mockServer.delete.mockResolvedValue({ success: true });

    await confirmDelete();

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Server Deleted" }),
    );
    expect(mockPush).toHaveBeenCalledWith("/dashboard/servers");
  });
});
