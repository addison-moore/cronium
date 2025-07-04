import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCError } from "@trpc/server";
import EventsList from "@/components/dashboard/EventsList";
import { trpc } from "@/lib/trpc";
import { EventStatus, EventType, RunLocation, TimeUnit } from "@/shared/schema";

// Add Jest types for mocking
// Add Jest types for mocking

// Mock the toast hook
jest.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

// Mock next-intl
jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock the child components
jest.mock("@/components/event-list", () => ({
  EventsFilters: ({
    onFiltersChange,
    onClearFilters,
  }: {
    onFiltersChange: (filters: Record<string, unknown>) => void;
    onClearFilters: () => void;
  }) => (
    <div data-testid="events-filters">
      <button onClick={() => onFiltersChange({ searchTerm: "test" })}>
        Change Filters
      </button>
      <button onClick={onClearFilters}>Clear Filters</button>
    </div>
  ),
  EventsTable: ({
    events,
    onEventRun,
    onEventDelete,
    onEventStatusChange,
  }: {
    events: Array<{ id: number; name: string }>;
    onEventRun: (id: number) => void;
    onEventDelete: (id: number) => void;
    onEventStatusChange: (id: number, status: EventStatus) => void;
  }) => (
    <div data-testid="events-table">
      {events.map((event) => (
        <div key={`event-${event.id}`} data-testid={`event-${event.id}`}>
          <span>{event.name}</span>
          <button onClick={() => onEventRun(event.id)}>Run</button>
          <button onClick={() => onEventDelete(event.id)}>Delete</button>
          <button
            onClick={() => onEventStatusChange(event.id, EventStatus.ACTIVE)}
          >
            Activate
          </button>
        </div>
      ))}
    </div>
  ),
  BulkActionsToolbar: ({
    onBulkDelete,
    onBulkActivate,
  }: {
    onBulkDelete: () => void;
    onBulkActivate: () => void;
  }) => (
    <div data-testid="bulk-actions">
      <button onClick={onBulkDelete}>Bulk Delete</button>
      <button onClick={onBulkActivate}>Bulk Activate</button>
    </div>
  ),
}));

// Mock tRPC
jest.mock("@/lib/trpc", () => {
  // Create mock functions with proper structure
  const createMockQuery = () =>
    jest.fn().mockReturnValue({
      trpc: {},
      data: undefined,
      isLoading: false,
      refetch: jest.fn(),
    });

  const createMockMutation = () =>
    jest.fn().mockReturnValue({
      trpc: {},
      mutateAsync: jest.fn(),
    });

  return {
    trpc: {
      events: {
        getAll: {
          useQuery: createMockQuery(),
        },
        delete: {
          useMutation: createMockMutation(),
        },
        execute: {
          useMutation: createMockMutation(),
        },
        create: {
          useMutation: createMockMutation(),
        },
        update: {
          useMutation: createMockMutation(),
        },
        activate: {
          useMutation: createMockMutation(),
        },
        deactivate: {
          useMutation: createMockMutation(),
        },
        download: {
          useMutation: createMockMutation(),
        },
      },
      servers: {
        getAll: {
          useQuery: createMockQuery(),
        },
      },
      workflows: {
        getAll: {
          useQuery: createMockQuery(),
        },
      },
    },
  };
});

const mockTrpc = trpc as unknown as {
  events: {
    getAll: { useQuery: jest.MockedFunction<() => unknown> };
    delete: { useMutation: jest.MockedFunction<() => unknown> };
    execute: { useMutation: jest.MockedFunction<() => unknown> };
    create: { useMutation: jest.MockedFunction<() => unknown> };
    update: { useMutation: jest.MockedFunction<() => unknown> };
    activate: { useMutation: jest.MockedFunction<() => unknown> };
    deactivate: { useMutation: jest.MockedFunction<() => unknown> };
    download: { useMutation: jest.MockedFunction<() => unknown> };
  };
  servers: {
    getAll: { useQuery: jest.MockedFunction<() => unknown> };
  };
  workflows: {
    getAll: { useQuery: jest.MockedFunction<() => unknown> };
  };
};

describe("EventsList-trpc", () => {
  let queryClient: QueryClient;

  const mockEvents = [
    {
      id: 1,
      name: "Test Event 1",
      description: "Test description",
      type: EventType.NODEJS,
      status: EventStatus.ACTIVE,
      runLocation: RunLocation.LOCAL,
      timeoutValue: 30,
      timeoutUnit: TimeUnit.MINUTES,
      retries: 0,
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      nextRunAt: null,
      tags: [],
      eventServers: [],
    },
    {
      id: 2,
      name: "Test Event 2",
      description: "Another test",
      type: EventType.PYTHON,
      status: EventStatus.PAUSED,
      runLocation: RunLocation.REMOTE,
      timeoutValue: 60,
      timeoutUnit: TimeUnit.SECONDS,
      retries: 1,
      createdAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      nextRunAt: new Date().toISOString(),
      tags: ["test"],
      eventServers: [1],
    },
  ];

  const mockServers = [
    { id: 1, name: "Server 1", host: "localhost" },
    { id: 2, name: "Server 2", host: "remote.com" },
  ];

  const mockWorkflows = [
    { id: 1, name: "Workflow 1", description: "Test workflow" },
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default mock implementations
    mockTrpc.events.getAll.useQuery.mockReturnValue({
      trpc: {},
      data: { events: mockEvents, total: 2, hasMore: false },
      isLoading: false,
      refetch: jest.fn(),
    });

    mockTrpc.servers.getAll.useQuery.mockReturnValue({
      trpc: {},
      data: { servers: mockServers, total: 2, hasMore: false },
    });

    mockTrpc.workflows.getAll.useQuery.mockReturnValue({
      trpc: {},
      data: { workflows: mockWorkflows, total: 1, hasMore: false },
    });

    // Setup mutation mocks
    mockTrpc.events.delete.useMutation.mockReturnValue({
      trpc: {},
      mutateAsync: jest.fn(),
    });

    mockTrpc.events.execute.useMutation.mockReturnValue({
      trpc: {},
      mutateAsync: jest.fn(),
    });

    mockTrpc.events.create.useMutation.mockReturnValue({
      trpc: {},
      mutateAsync: jest.fn(),
    });

    mockTrpc.events.update.useMutation.mockReturnValue({
      trpc: {},
      mutateAsync: jest.fn(),
    });

    mockTrpc.events.activate.useMutation.mockReturnValue({
      trpc: {},
      mutateAsync: jest.fn(),
    });

    mockTrpc.events.deactivate.useMutation.mockReturnValue({
      trpc: {},
      mutateAsync: jest.fn(),
    });

    mockTrpc.events.download.useMutation.mockReturnValue({
      trpc: {},
      mutateAsync: jest.fn(),
    });
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <EventsList />
      </QueryClientProvider>,
    );
  };

  it("renders the component with events", () => {
    renderComponent();

    expect(screen.getByTestId("events-filters")).toBeInTheDocument();
    expect(screen.getByTestId("events-table")).toBeInTheDocument();
    expect(screen.getByTestId("bulk-actions")).toBeInTheDocument();

    // Check if events are displayed
    expect(screen.getByTestId("event-1")).toBeInTheDocument();
    expect(screen.getByTestId("event-2")).toBeInTheDocument();
    expect(screen.getByText("Test Event 1")).toBeInTheDocument();
    expect(screen.getByText("Test Event 2")).toBeInTheDocument();
  });

  it("handles loading state", () => {
    mockTrpc.events.getAll.useQuery.mockReturnValue({
      trpc: {},
      data: undefined,
      isLoading: true,
      refetch: jest.fn(),
    });

    renderComponent();

    // Should still render the component structure
    expect(screen.getByTestId("events-filters")).toBeInTheDocument();
    expect(screen.getByTestId("events-table")).toBeInTheDocument();
  });

  it("handles event running", async () => {
    const mockExecute = jest.fn().mockResolvedValue({});
    mockTrpc.events.execute.useMutation.mockReturnValue({
      trpc: {},
      mutateAsync: mockExecute,
    });

    renderComponent();

    // Specifically target the Run button within event-1 element
    const event1 = screen.getByTestId("event-1");
    const runButton = within(event1).getByText("Run");
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith({ id: 1, manual: true });
    });
  });

  it("handles event deletion", async () => {
    const mockDelete = jest.fn().mockResolvedValue({});
    mockTrpc.events.delete.useMutation.mockReturnValue({
      trpc: {},
      mutateAsync: mockDelete,
    });

    renderComponent();

    // Use within to scope the query to the first event element
    const firstEvent = screen.getByTestId("event-1");
    const deleteButton = within(firstEvent).getByRole("button", {
      name: "Delete",
    });
    fireEvent.click(deleteButton as HTMLElement);

    // Should open confirmation dialog
    expect(screen.getByText("DeleteEventConfirmation")).toBeInTheDocument();

    // Confirm deletion - get the last Delete button which is the confirmation button
    const confirmButton = screen.getAllByText("Delete").slice(-1)[0];
    fireEvent.click(confirmButton as HTMLElement);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith({ id: 1 });
    });
  });

  it("handles status change", async () => {
    const mockActivate = jest.fn().mockResolvedValue({});
    mockTrpc.events.activate.useMutation.mockReturnValue({
      trpc: {},
      mutateAsync: mockActivate,
    });

    renderComponent();

    // Find the activate button within the event-2 test container (since it's first in sort order)
    const event2Container = screen.getByTestId("event-2");
    const activateButton = within(event2Container).getByText("Activate");
    fireEvent.click(activateButton as HTMLElement);

    await waitFor(() => {
      expect(mockActivate).toHaveBeenCalledWith({ id: 2, resetCounter: false });
    });
  });

  it("handles filter changes", () => {
    renderComponent();

    const changeFiltersButton = screen.getByText("Change Filters");
    fireEvent.click(changeFiltersButton as HTMLElement);

    // Should trigger filter change logic
    // This is mainly testing that the component doesn't crash
    expect(screen.getByTestId("events-table")).toBeInTheDocument();
  });

  it("handles clear filters", () => {
    renderComponent();

    const clearFiltersButton = screen.getByText("Clear Filters");
    fireEvent.click(clearFiltersButton as HTMLElement);

    // Should reset filters and pagination
    expect(screen.getByTestId("events-table")).toBeInTheDocument();
  });

  it("handles bulk operations", async () => {
    const mockBulkDelete = jest.fn().mockResolvedValue({});
    mockTrpc.events.delete.useMutation.mockReturnValue({
      trpc: {},
      mutateAsync: mockBulkDelete,
    });

    renderComponent();

    const bulkDeleteButton = screen.getByText("Bulk Delete");
    fireEvent.click(bulkDeleteButton as HTMLElement);

    // Should handle bulk delete (though no events are selected in this test)
    expect(screen.getByTestId("bulk-actions")).toBeInTheDocument();
  });

  it("handles mutation errors gracefully", async () => {
    const mockDelete = jest.fn().mockRejectedValue(
      new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database error",
      }),
    );

    mockTrpc.events.delete.useMutation.mockReturnValue({
      trpc: {},
      mutateAsync: mockDelete,
    });

    renderComponent();

    // Use within to scope the query to the first event element
    const firstEvent = screen.getByTestId("event-1");
    const deleteButton = within(firstEvent).getByRole("button", {
      name: "Delete",
    });
    fireEvent.click(deleteButton as HTMLElement);

    // Confirm deletion - get the last Delete button which is the confirmation button
    const confirmButton = screen.getAllByText("Delete").slice(-1)[0];
    fireEvent.click(confirmButton as HTMLElement);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith({ id: 1 });
    });

    // Component should handle the error gracefully
    expect(screen.getByTestId("events-table")).toBeInTheDocument();
  });

  it("handles empty events list", () => {
    mockTrpc.events.getAll.useQuery.mockReturnValue({
      trpc: {},
      data: { events: [], total: 0, hasMore: false },
      isLoading: false,
      refetch: jest.fn(),
    });

    renderComponent();
  });
});
