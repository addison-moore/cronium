import {
  type Workflow,
  ConnectionType,
  EventStatus,
  RunLocation,
  TimeUnit,
  WorkflowTriggerType,
} from "@/shared/schema";
import {
  type WorkflowDetailsFormData,
  type WorkflowEdge,
  type WorkflowNode,
  applyCronSchedulingToggle,
  applyServerOverrideToggle,
  buildWorkflowUpdatePayload,
  workflowDetailsSchema,
  workflowToFormValues,
} from "../workflow-details";

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 7,
    userId: "user-1",
    name: "Nightly deploy",
    description: "Deploys at night",
    triggerType: WorkflowTriggerType.SCHEDULE,
    webhookKey: null,
    webhookKeyHash: null,
    source: null,
    scheduleNumber: 2,
    scheduleUnit: TimeUnit.HOURS,
    customSchedule: null,
    nextRunAt: null,
    runLocation: RunLocation.LOCAL,
    overrideEventServers: false,
    overrideServerIds: null,
    status: EventStatus.ACTIVE,
    shared: false,
    tags: ["ops"],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

function makeFormData(
  overrides: Partial<WorkflowDetailsFormData> = {},
): WorkflowDetailsFormData {
  return {
    name: "Nightly deploy",
    description: "",
    triggerType: WorkflowTriggerType.MANUAL,
    status: EventStatus.DRAFT,
    tags: [],
    customSchedule: "",
    scheduleNumber: null,
    scheduleUnit: null,
    useCronScheduling: false,
    overrideEventServers: false,
    overrideServerIds: [],
    shared: false,
    ...overrides,
  };
}

describe("workflowDetailsSchema", () => {
  it("accepts a complete valid payload", () => {
    const result = workflowDetailsSchema.safeParse(makeFormData());
    expect(result.success).toBe(true);
  });

  it.each([
    {
      name: "empty name",
      data: makeFormData({ name: "" }),
      path: "name",
      message: "Name is required",
    },
    {
      name: "name over 100 chars",
      data: makeFormData({ name: "x".repeat(101) }),
      path: "name",
      message: "Name is too long",
    },
    {
      name: "description over 500 chars",
      data: makeFormData({ description: "x".repeat(501) }),
      path: "description",
      message: "Description is too long",
    },
    {
      name: "scheduleNumber below 1",
      data: makeFormData({ scheduleNumber: 0 }),
      path: "scheduleNumber",
      message: "Schedule number must be at least 1",
    },
    {
      name: "non-numeric scheduleNumber",
      data: makeFormData({ scheduleNumber: "abc" }),
      path: "scheduleNumber",
      message: "Schedule number must be at least 1",
    },
    {
      name: "invalid scheduleUnit",
      data: makeFormData({ scheduleUnit: "fortnights" }),
      path: "scheduleUnit",
      message: "Invalid time unit",
    },
  ])("rejects $name", ({ data, path, message }) => {
    const result = workflowDetailsSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === path);
      expect(issue?.message).toBe(message);
    }
  });

  it("allows null schedule fields (unscheduled workflows)", () => {
    const result = workflowDetailsSchema.safeParse(
      makeFormData({ scheduleNumber: null, scheduleUnit: null }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a numeric string scheduleNumber and every TimeUnit", () => {
    for (const unit of Object.values(TimeUnit)) {
      const result = workflowDetailsSchema.safeParse(
        makeFormData({ scheduleNumber: "5", scheduleUnit: unit }),
      );
      expect(result.success).toBe(true);
    }
  });
});

describe("workflowToFormValues", () => {
  it("maps a workflow row onto form values", () => {
    expect(workflowToFormValues(makeWorkflow())).toEqual({
      name: "Nightly deploy",
      description: "Deploys at night",
      triggerType: WorkflowTriggerType.SCHEDULE,
      status: EventStatus.ACTIVE,
      tags: ["ops"],
      customSchedule: "",
      scheduleNumber: 2,
      scheduleUnit: TimeUnit.HOURS,
      useCronScheduling: false,
      overrideEventServers: false,
      overrideServerIds: [],
      shared: false,
    });
  });

  it("derives useCronScheduling from the presence of a cron expression", () => {
    const values = workflowToFormValues(
      makeWorkflow({ customSchedule: "0 0 * * *" }),
    );
    expect(values.useCronScheduling).toBe(true);
    expect(values.customSchedule).toBe("0 0 * * *");
  });

  it("defaults nullish fields", () => {
    const values = workflowToFormValues(
      makeWorkflow({
        description: null,
        scheduleNumber: null,
        scheduleUnit: null,
        tags: null,
        overrideServerIds: [4, 5],
      }),
    );
    expect(values.description).toBe("");
    expect(values.scheduleNumber).toBeNull();
    expect(values.scheduleUnit).toBeNull();
    expect(values.tags).toEqual([]);
    expect(values.overrideServerIds).toEqual([4, 5]);
  });
});

describe("buildWorkflowUpdatePayload", () => {
  const nodes: WorkflowNode[] = [
    {
      id: "node-1",
      type: "whatever",
      position: { x: 10, y: 20 },
      data: {
        eventId: 11,
        label: "Step one",
        type: "BASH",
        eventTypeIcon: "BASH",
        // no description/tags/server fields
      },
    },
  ];
  const edges: WorkflowEdge[] = [
    {
      id: "e1",
      source: "node-1",
      target: "node-2",
      // no type/animated/data
    },
    {
      id: "e2",
      source: "node-2",
      target: "node-3",
      data: { connectionType: ConnectionType.ON_FAILURE },
    },
  ];

  it("spreads the form data behind the workflow id", () => {
    const data = makeFormData({ name: "Renamed", shared: true });
    const payload = buildWorkflowUpdatePayload(7, data, [], []);
    expect(payload.id).toBe(7);
    expect(payload.name).toBe("Renamed");
    expect(payload.shared).toBe(true);
    expect(payload.nodes).toEqual([]);
    expect(payload.edges).toEqual([]);
  });

  it("normalizes nodes to the eventNode shape with tag defaults", () => {
    const payload = buildWorkflowUpdatePayload(7, makeFormData(), nodes, []);
    expect(payload.nodes).toEqual([
      {
        id: "node-1",
        type: "eventNode",
        position: { x: 10, y: 20 },
        data: {
          eventId: 11,
          label: "Step one",
          type: "BASH",
          eventTypeIcon: "BASH",
          description: undefined,
          tags: [],
          serverId: undefined,
          serverName: undefined,
          createdAt: undefined,
          updatedAt: undefined,
        },
      },
    ]);
  });

  it("normalizes edges: connectionEdge type, forced animation, ALWAYS default", () => {
    const payload = buildWorkflowUpdatePayload(7, makeFormData(), [], edges);
    expect(payload.edges).toEqual([
      {
        id: "e1",
        source: "node-1",
        target: "node-2",
        type: "connectionEdge",
        animated: true,
        data: { connectionType: ConnectionType.ALWAYS },
      },
      {
        id: "e2",
        source: "node-2",
        target: "node-3",
        type: "connectionEdge",
        animated: true,
        data: { connectionType: ConnectionType.ON_FAILURE },
      },
    ]);
  });
});

describe("applyCronSchedulingToggle", () => {
  it("enabling cron clears the simple interval and keeps the cron string", () => {
    const prev = makeFormData({
      customSchedule: "0 0 * * *",
      scheduleNumber: 5,
      scheduleUnit: TimeUnit.MINUTES,
    });
    expect(applyCronSchedulingToggle(prev, true)).toEqual({
      ...prev,
      useCronScheduling: true,
      customSchedule: "0 0 * * *",
      scheduleNumber: null,
      scheduleUnit: null,
    });
  });

  it("disabling cron clears the cron string and keeps the interval", () => {
    const prev = makeFormData({
      useCronScheduling: true,
      customSchedule: "0 0 * * *",
      scheduleNumber: 5,
      scheduleUnit: TimeUnit.MINUTES,
    });
    expect(applyCronSchedulingToggle(prev, false)).toEqual({
      ...prev,
      useCronScheduling: false,
      customSchedule: "",
      scheduleNumber: 5,
      scheduleUnit: TimeUnit.MINUTES,
    });
  });

  it("treats 'indeterminate' as enabled (matches the checkbox truthiness)", () => {
    const result = applyCronSchedulingToggle(makeFormData(), "indeterminate");
    expect(result.useCronScheduling).toBe(true);
  });
});

describe("applyServerOverrideToggle", () => {
  it("turning the override off clears the selected servers", () => {
    const prev = makeFormData({
      overrideEventServers: true,
      overrideServerIds: [1, 2],
    });
    expect(applyServerOverrideToggle(prev, false)).toEqual({
      ...prev,
      overrideEventServers: false,
      overrideServerIds: [],
    });
  });

  it("turning the override on keeps the previous selection", () => {
    const prev = makeFormData({ overrideServerIds: [3] });
    expect(applyServerOverrideToggle(prev, true)).toEqual({
      ...prev,
      overrideEventServers: true,
      overrideServerIds: [3],
    });
  });
});
