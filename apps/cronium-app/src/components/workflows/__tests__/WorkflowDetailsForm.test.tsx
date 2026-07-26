/**
 * RTL tests for WorkflowDetailsForm — the workflow config panel.
 *
 * Covers the user-visible trigger-type switching (MANUAL/SCHEDULE/WEBHOOK),
 * the schedule section (interval vs cron), form validation, and the payload
 * handed to the `workflows.update` mutation.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkflowDetailsForm from "../WorkflowDetailsForm";
import {
  type Workflow,
  ConnectionType,
  EventStatus,
  RunLocation,
  TimeUnit,
  WorkflowTriggerType,
} from "@/shared/schema";
import type { WorkflowEdge, WorkflowNode } from "../lib/workflow-details";

const mockMutateAsync = jest.fn();

jest.mock("@/lib/trpc", () => ({
  trpc: {
    workflows: {
      update: {
        useMutation: jest.fn(() => ({
          mutateAsync: mockMutateAsync,
          isPending: false,
        })),
      },
    },
  },
}));

// jsdom lacks the pointer-capture and scroll APIs Radix Select relies on.
beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: jest.fn(),
    hasPointerCapture: jest.fn(() => false),
    setPointerCapture: jest.fn(),
    releasePointerCapture: jest.fn(),
  });
});

beforeEach(() => {
  mockMutateAsync.mockReset();
  mockMutateAsync.mockResolvedValue(undefined);
});

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 7,
    userId: "user-1",
    name: "Nightly deploy",
    description: "Deploys at night",
    triggerType: WorkflowTriggerType.MANUAL,
    webhookKey: null,
    webhookKeyHash: null,
    source: null,
    scheduleNumber: null,
    scheduleUnit: null,
    customSchedule: null,
    nextRunAt: null,
    runLocation: RunLocation.LOCAL,
    overrideEventServers: false,
    overrideServerIds: null,
    status: EventStatus.DRAFT,
    shared: false,
    tags: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

const nodes: WorkflowNode[] = [
  {
    id: "node-1",
    type: "custom",
    position: { x: 10, y: 20 },
    data: {
      eventId: 11,
      label: "Step one",
      type: "BASH",
      eventTypeIcon: "BASH",
    },
  },
];

const edges: WorkflowEdge[] = [
  { id: "e1", source: "node-1", target: "node-2" },
];

function renderForm(workflow = makeWorkflow()) {
  const onUpdate = jest.fn();
  render(
    <WorkflowDetailsForm
      workflow={workflow}
      workflowNodes={nodes}
      workflowEdges={edges}
      onUpdate={onUpdate}
    />,
  );
  return { onUpdate };
}

async function findTriggerTypeCombobox(currentLabel: RegExp) {
  // The trigger-type select is the combobox whose visible value is the
  // current trigger label. (Comboboxes don't take their accessible name from
  // their contents, so match on the rendered text instead.)
  return waitFor(() => {
    const match = screen
      .getAllByRole("combobox")
      .find((el) => currentLabel.test(el.textContent ?? ""));
    if (!match) {
      throw new Error(`No combobox showing ${String(currentLabel)}`);
    }
    return match;
  });
}

describe("WorkflowDetailsForm", () => {
  it("renders the workflow's stored values", async () => {
    renderForm();

    expect(
      await screen.findByDisplayValue("Nightly deploy"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Deploys at night")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save Changes" }),
    ).toBeInTheDocument();
    // Manual trigger: no schedule section
    expect(
      screen.queryByLabelText("Use Cron Expression"),
    ).not.toBeInTheDocument();
  });

  it("reveals interval fields when switching the trigger type to Scheduled", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderForm();
    await screen.findByDisplayValue("Nightly deploy");

    await user.click(await findTriggerTypeCombobox(/manual/i));
    await user.click(await screen.findByRole("option", { name: /scheduled/i }));

    expect(screen.getByLabelText("Use Cron Expression")).toBeInTheDocument();
    expect(screen.getByLabelText("Every")).toBeInTheDocument();
    expect(screen.getByText("Unit")).toBeInTheDocument();
    // Interval mode is the default: no cron input yet
    expect(screen.queryByLabelText("Cron Expression")).not.toBeInTheDocument();
  });

  it("swaps interval fields for a cron input when 'Use Cron Expression' is checked", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderForm();
    await screen.findByDisplayValue("Nightly deploy");

    await user.click(await findTriggerTypeCombobox(/manual/i));
    await user.click(await screen.findByRole("option", { name: /scheduled/i }));

    await user.click(screen.getByLabelText("Use Cron Expression"));

    const cronInput = screen.getByLabelText("Cron Expression");
    expect(cronInput).toBeInTheDocument();
    expect(screen.queryByLabelText("Every")).not.toBeInTheDocument();

    await user.type(cronInput, "0 0 * * *");
    expect(cronInput).toHaveValue("0 0 * * *");

    // Unchecking returns to the interval fields and clears the cron input
    await user.click(screen.getByLabelText("Use Cron Expression"));
    expect(screen.getByLabelText("Every")).toBeInTheDocument();
    expect(screen.queryByLabelText("Cron Expression")).not.toBeInTheDocument();
  });

  it("hides the schedule section again for Webhook triggers", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderForm();
    await screen.findByDisplayValue("Nightly deploy");

    await user.click(await findTriggerTypeCombobox(/manual/i));
    await user.click(await screen.findByRole("option", { name: /scheduled/i }));
    expect(screen.getByLabelText("Use Cron Expression")).toBeInTheDocument();

    await user.click(await findTriggerTypeCombobox(/scheduled/i));
    await user.click(await screen.findByRole("option", { name: /webhook/i }));
    expect(
      screen.queryByLabelText("Use Cron Expression"),
    ).not.toBeInTheDocument();
  });

  it("shows a validation error and does not submit when the name is empty", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderForm();

    const nameInput = await screen.findByDisplayValue("Nightly deploy");
    await user.clear(nameInput);
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("submits the update payload with normalized nodes and edges", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderForm();

    const nameInput = await screen.findByDisplayValue("Nightly deploy");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed workflow");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));

    const payload = mockMutateAsync.mock.calls[0]![0] as {
      id: number;
      name: string;
      nodes: Array<{ type: string; data: { tags: string[] } }>;
      edges: Array<{
        type: string;
        animated: boolean;
        data: { connectionType: ConnectionType };
      }>;
    };

    expect(payload.id).toBe(7);
    expect(payload.name).toBe("Renamed workflow");
    expect(payload.nodes).toEqual([
      expect.objectContaining({
        id: "node-1",
        type: "eventNode",
        position: { x: 10, y: 20 },
        data: expect.objectContaining({
          eventId: 11,
          label: "Step one",
          tags: [],
        }),
      }),
    ]);
    expect(payload.edges).toEqual([
      {
        id: "e1",
        source: "node-1",
        target: "node-2",
        type: "connectionEdge",
        animated: true,
        data: { connectionType: ConnectionType.ALWAYS },
      },
    ]);
  });

  it("keeps schedule values when saving a scheduled workflow", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderForm(
      makeWorkflow({
        triggerType: WorkflowTriggerType.SCHEDULE,
        scheduleNumber: 2,
        scheduleUnit: TimeUnit.HOURS,
      }),
    );

    await screen.findByDisplayValue("Nightly deploy");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockMutateAsync.mock.calls[0]![0] as {
      triggerType: WorkflowTriggerType;
      scheduleNumber: number | null;
      scheduleUnit: TimeUnit | null;
    };
    expect(payload.triggerType).toBe(WorkflowTriggerType.SCHEDULE);
    expect(payload.scheduleNumber).toBe(2);
    expect(payload.scheduleUnit).toBe(TimeUnit.HOURS);
  });

  // Regression: the trigger/schedule controls used to write to a parallel
  // local-state mirror that never reached react-hook-form, so these edits
  // were silently dropped from the save payload.
  it("saves trigger-type and schedule edits made through the UI", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderForm();
    await screen.findByDisplayValue("Nightly deploy");

    await user.click(await findTriggerTypeCombobox(/manual/i));
    await user.click(await screen.findByRole("option", { name: /scheduled/i }));

    await user.type(screen.getByLabelText("Every"), "5");
    // The unit select renders no value yet; it's the combobox inside the
    // schedule card next to the "Unit" label.
    const unitSelect = screen
      .getAllByRole("combobox")
      .find((el) => (el.textContent ?? "").includes("Select unit"));
    expect(unitSelect).toBeDefined();
    await user.click(unitSelect!);
    await user.click(await screen.findByRole("option", { name: /minute/i }));

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockMutateAsync.mock.calls[0]![0] as {
      triggerType: WorkflowTriggerType;
      scheduleNumber: number | null;
      scheduleUnit: TimeUnit | null;
    };
    expect(payload.triggerType).toBe(WorkflowTriggerType.SCHEDULE);
    expect(payload.scheduleNumber).toBe(5);
    expect(payload.scheduleUnit).toBe(TimeUnit.MINUTES);
  });

  // Regression: the local-state mirror was seeded with hardcoded defaults and
  // only synced after the first form change, so a SCHEDULE workflow initially
  // rendered as "Manual" with the schedule section hidden.
  it("renders a scheduled workflow's schedule section on first paint", async () => {
    renderForm(
      makeWorkflow({
        triggerType: WorkflowTriggerType.SCHEDULE,
        scheduleNumber: 2,
        scheduleUnit: TimeUnit.HOURS,
      }),
    );

    await screen.findByDisplayValue("Nightly deploy");
    expect(await findTriggerTypeCombobox(/scheduled/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Every")).toHaveValue(2);
    expect(screen.getByLabelText("Use Cron Expression")).toBeInTheDocument();
  });
});
