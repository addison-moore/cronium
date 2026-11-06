/**
 * The Edit tab with the real form and the real toast store, because the bug this
 * guards came from how they're wired. EventEditTab calls useToast, so every toast
 * re-renders it, and it builds a new initialData object each time. The form used
 * to re-apply the saved tags, env vars and servers on each new object, so a
 * refused save lost what had been edited, and a toast closing re-ticked a server.
 * A test that renders the form alone, with a stubbed toast, can't see any of this.
 */
import React, { act } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUpdateMutateAsync = jest.fn();

jest.mock("@/lib/trpc", () => ({
  trpc: {
    events: {
      getById: {
        useQuery: () => ({ refetch: jest.fn() }),
      },
      validateCron: {
        useQuery: () => ({ data: undefined }),
      },
      create: {
        useMutation: () => ({ mutateAsync: jest.fn() }),
      },
      update: {
        useMutation: () => ({ mutateAsync: mockUpdateMutateAsync }),
      },
    },
    servers: {
      getAll: {
        useQuery: () => ({
          data: {
            servers: [{ id: 6, name: "live-box", address: "192.0.2.10" }],
          },
        }),
      },
      getGroups: {
        useQuery: () => ({ data: { groups: [] } }),
      },
    },
    tools: {
      getAll: {
        useQuery: () => ({ data: { tools: [] } }),
      },
    },
    settings: {
      getEditorSettings: {
        useQuery: () => ({ data: undefined }),
      },
      updateEditorSettings: {
        useMutation: () => ({
          mutate: jest.fn(),
          mutateAsync: jest.fn(),
          isPending: false,
        }),
      },
    },
  },
}));

// Only the editor is stubbed. useToast stays real: it's what re-renders the tab.
jest.mock("@cronium/ui", () => {
  const actual =
    jest.requireActual<typeof import("@cronium/ui")>("@cronium/ui");
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    MonacoEditor: ({
      value,
      onChange,
    }: {
      value?: string;
      onChange?: (value: string | undefined) => void;
    }) =>
      ReactActual.createElement("textarea", {
        "data-testid": "monaco-stub",
        value: value ?? "",
        onChange: (e: { target: { value: string } }) =>
          onChange?.(e.target.value),
      }),
  };
});

// next/dynamic's chunk never loads under Jest, so use the module it wraps.
jest.mock("@/components/event-form/EventForm-lazy", () => ({
  __esModule: true,
  default: jest.requireActual("@/components/event-form/EventForm").default,
}));

jest.mock("@/components/dashboard/AIScriptAssistant-lazy", () => ({
  __esModule: true,
  default: () => null,
}));

import { toast } from "@cronium/ui";
import { EventEditTab } from "../EventEditTab";
import type { Event } from "../types";
import { EventStatus, EventType, RunLocation } from "@/shared/schema";

const event: Event = {
  id: 5,
  name: "Nightly job",
  type: EventType.BASH,
  status: EventStatus.DRAFT,
  content: "echo hello",
  scheduleNumber: 5,
  scheduleUnit: "MINUTES",
  customSchedule: null,
  runLocation: RunLocation.REMOTE,
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
  lastRunAt: null,
  nextRunAt: null,
  successCount: 0,
  executionCount: 0,
  maxExecutions: 0,
  resetCounterOnActive: false,
  failureCount: 0,
  timeoutValue: 30,
  timeoutUnit: "SECONDS",
  retries: 0,
  tags: [],
  environmentVariables: [],
  events: [],
  servers: [
    {
      id: 9,
      name: "retired-box",
      address: "192.0.2.20",
      port: 22,
      isArchived: true,
    },
  ],
};

const ARCHIVED_ROW = "retired-box (192.0.2.20) Archived";
const LIVE_ROW = "live-box (192.0.2.10)";

function renderTab() {
  render(
    <EventEditTab
      event={event}
      onEventUpdate={jest.fn()}
      onRefreshLogs={jest.fn()}
    />,
  );
  return userEvent.setup();
}

describe("EventEditTab after a refused save", () => {
  beforeEach(() => {
    mockUpdateMutateAsync.mockReset();
    mockUpdateMutateAsync.mockRejectedValue(
      new Error("This event can't be saved"),
    );
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function refusedSave(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Update Event" }));
    await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Update Event" }),
      ).toBeEnabled(),
    );
  }

  it("keeps the servers and env vars as they were edited", async () => {
    const user = renderTab();
    await screen.findByRole("checkbox", { name: ARCHIVED_ROW, checked: true });
    await user.click(screen.getByRole("checkbox", { name: LIVE_ROW }));
    await user.click(screen.getByRole("button", { name: "Add Variable" }));
    fireEvent.change(screen.getByLabelText("Key"), {
      target: { value: "MY_VAR" },
    });

    await refusedSave(user);

    expect(screen.getByRole("checkbox", { name: LIVE_ROW })).toBeChecked();
    expect(screen.getByLabelText("Key")).toHaveValue("MY_VAR");
  });

  it("leaves a server unticked when the next toast comes or goes", async () => {
    const user = renderTab();
    await refusedSave(user);
    const row = screen.getByRole("checkbox", { name: ARCHIVED_ROW });
    expect(row).toBeChecked();

    await user.click(row);
    expect(row).not.toBeChecked();

    // Any change to the toast store re-renders the tab, closing one included.
    let shown: ReturnType<typeof toast> | undefined;
    act(() => {
      shown = toast({ title: "Something else" });
    });
    expect(row).not.toBeChecked();
    act(() => {
      shown?.dismiss();
    });
    expect(row).not.toBeChecked();
  });
});
