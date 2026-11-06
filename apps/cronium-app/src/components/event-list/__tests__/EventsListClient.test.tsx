/**
 * A failed fork has to reach the user. There is no global mutation error
 * handler, and handleForkEvent swallows the rejection, so without the mutation's
 * own onError a refused fork looks like a click that did nothing.
 *
 * The useMutation stub calls the callbacks it is given, as react-query does; the
 * table is a stub because only the wiring from its fork action is under test.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockToast = jest.fn();
const mockFork = jest.fn();

interface MutationOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/hooks/use-persistent-pagination", () => ({
  usePersistentPagination: () => ({
    itemsPerPage: 10,
    setItemsPerPage: jest.fn(),
  }),
}));

jest.mock("@/components/event-list", () => ({
  EventsFilters: () => null,
  BulkActionsToolbar: () => null,
  EventsTable: ({ onEventFork }: { onEventFork: (id: number) => void }) => (
    <button onClick={() => onEventFork(1)}>Fork</button>
  ),
}));

jest.mock("@/lib/trpc", () => {
  const idle = { useMutation: () => ({ mutateAsync: jest.fn() }) };
  return {
    trpc: {
      events: {
        delete: idle,
        execute: idle,
        create: idle,
        update: idle,
        activate: idle,
        deactivate: idle,
        download: idle,
        fork: {
          useMutation: ({ onSuccess, onError }: MutationOptions) => ({
            mutateAsync: async (input: { id: number }) => {
              try {
                const result: unknown = await mockFork(input);
                onSuccess?.();
                return result;
              } catch (error) {
                onError?.(error as Error);
                throw error;
              }
            },
          }),
        },
      },
    },
  };
});

import { EventsListClient } from "../EventsListClient";

function renderList() {
  render(<EventsListClient initialEvents={[]} servers={[]} workflows={[]} />);
}

describe("EventsListClient fork", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the server's reason when a fork is refused", async () => {
    const reason =
      "This event can't be forked while it's linked to an archived server: retired-box. Restore it or remove it from the event, then try again.";
    mockFork.mockRejectedValue(new Error(reason));
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "Fork" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Error",
        description: reason,
        variant: "destructive",
      }),
    );
    expect(mockFork).toHaveBeenCalledWith({ id: 1 });
  });

  it("says the fork worked when it does", async () => {
    mockFork.mockResolvedValue({ id: 5 });
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "Fork" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "success" }),
      ),
    );
    expect(mockToast).toHaveBeenCalledTimes(1);
  });
});
