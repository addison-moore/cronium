/**
 * Check Status in the servers table has to say when it fails. react-query is real,
 * errors are real TRPCClientErrors, and the table is a stub because Radix menus add
 * nothing here.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";

const mockToast = jest.fn();
const mockServer = {
  checkHealth: jest.fn(),
  delete: jest.fn(),
  restore: jest.fn(),
  archive: jest.fn(),
};

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  toast: (...args: unknown[]): unknown => mockToast(...args),
  StandardizedTable: ({
    data,
    actions,
  }: {
    data: Array<{ id: number; name: string; online?: boolean }>;
    actions: (row: { id: number; name: string }) => Array<{
      label: string;
      onClick?: () => void;
      disabled?: boolean;
    }>;
  }) => (
    <>
      {data.map((row) => (
        <div key={row.id} data-testid={`row-${row.name}`}>
          <span data-testid="online">{String(row.online)}</span>
          {actions(row).map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          ))}
        </div>
      ))}
    </>
  ),
}));

jest.mock("@/components/server-list/ServerFilters", () => ({
  ServerFilters: () => null,
}));
jest.mock("@/components/server-list/ServerDeleteConfirmDialog", () => ({
  ServerDeleteConfirmDialog: () => null,
}));
jest.mock("@/hooks/use-persistent-pagination", () => ({
  usePersistentPagination: () => ({
    itemsPerPage: 10,
    setItemsPerPage: jest.fn(),
  }),
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
      servers: {
        getGroups: { useQuery: () => ({ data: undefined }) },
        getArchived: { useQuery: () => ({ data: undefined }) },
        checkHealth: procedure("checkHealth"),
        delete: procedure("delete"),
        restore: procedure("restore"),
        archive: procedure("archive"),
      },
    },
  };
});

import { ServersTableClient } from "../ServersTableClient";

const row = {
  id: 7,
  name: "web-1",
  address: "10.0.0.7",
  username: "deploy",
  port: 22,
  online: true,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

function renderTable() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ServersTableClient initialServers={[row]} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const inRow = () => within(screen.getByTestId("row-web-1"));

beforeEach(() => {
  jest.resetAllMocks();
});

describe("Check Status in the servers table", () => {
  it("shows the server's reason, once, when it's refused", async () => {
    mockServer.checkHealth.mockRejectedValue(
      TRPCClientError.from({
        error: {
          message: "Server not found",
          code: -32004,
          data: { code: "NOT_FOUND", httpStatus: 404, zodError: null },
        },
      }),
    );
    const user = renderTable();

    await user.click(inRow().getByRole("button", { name: "Check Status" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith({
      title: "Health Check Failed",
      description: "Server not found",
      variant: "destructive",
    });
  });

  it("gives the row back and leaves its status alone", async () => {
    mockServer.checkHealth.mockRejectedValue(new Error("Failed to fetch"));
    const user = renderTable();

    await user.click(inRow().getByRole("button", { name: "Check Status" }));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        inRow().getByRole("button", { name: "Check Status" }),
      ).toBeEnabled(),
    );
    expect(inRow().getByTestId("online")).toHaveTextContent("true");
  });

  it("still updates the row when it works", async () => {
    mockServer.checkHealth.mockResolvedValue({
      online: false,
      lastChecked: "2026-11-05T00:00:00.000Z",
    });
    const user = renderTable();

    await user.click(inRow().getByRole("button", { name: "Check Status" }));

    await waitFor(() =>
      expect(inRow().getByTestId("online")).toHaveTextContent("false"),
    );
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Server Offline" }),
    );
  });
});
