import { LogStatus } from "@/shared/schema";
import {
  type ExecutionListItem,
  filterExecutions,
  formatDuration,
  sortExecutions,
} from "../execution-history";

let nextId = 1;

function makeExecution(
  overrides: Partial<ExecutionListItem> = {},
): ExecutionListItem {
  return {
    id: nextId++,
    workflowId: 1,
    userId: "user-1",
    status: LogStatus.SUCCESS,
    triggerType: "manual",
    startedAt: new Date("2026-01-01T10:00:00Z"),
    completedAt: new Date("2026-01-01T10:01:00Z"),
    totalDuration: 60000,
    totalEvents: 1,
    successfulEvents: 1,
    failedEvents: 0,
    executionData: null,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    updatedAt: new Date("2026-01-01T10:01:00Z"),
    ...overrides,
  };
}

describe("formatDuration", () => {
  it.each([
    { input: null, expected: "N/A" },
    { input: 0, expected: "N/A" }, // 0 is treated as "no duration" (current behavior)
    { input: 500, expected: "0.50s" },
    { input: 3500, expected: "3.50s" },
    { input: 65000, expected: "1m 5.00s" },
    { input: 3725000, expected: "1h 2m 5.00s" },
    { input: 7322500, expected: "2h 2m 2.50s" },
  ])("formats $input ms as '$expected'", ({ input, expected }) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe("filterExecutions", () => {
  const executions = [
    makeExecution({
      workflowId: 1,
      workflowName: "Deploy pipeline",
      status: LogStatus.SUCCESS,
    }),
    makeExecution({
      workflowId: 2,
      workflowName: "Backup job",
      status: LogStatus.FAILURE,
    }),
    makeExecution({ workflowId: 33, status: LogStatus.RUNNING }), // no name
  ];

  it("returns everything with default filters", () => {
    expect(filterExecutions(executions, "", "all", "all")).toHaveLength(3);
  });

  it("matches the workflow name case-insensitively", () => {
    const result = filterExecutions(executions, "DEPLOY", "all", "all");
    expect(result.map((e) => e.workflowId)).toEqual([1]);
  });

  it("searches the 'Workflow <id>' fallback name for unnamed workflows", () => {
    const result = filterExecutions(executions, "workflow 33", "all", "all");
    expect(result.map((e) => e.workflowId)).toEqual([33]);
  });

  it("filters by status", () => {
    const result = filterExecutions(executions, "", LogStatus.FAILURE, "all");
    expect(result.map((e) => e.workflowId)).toEqual([2]);
  });

  it("combines search and status filters", () => {
    expect(
      filterExecutions(executions, "backup", LogStatus.SUCCESS, "all"),
    ).toHaveLength(0);
  });

  it("returns nothing for a concrete tag filter (tags not implemented yet)", () => {
    expect(filterExecutions(executions, "", "all", "some-tag")).toHaveLength(0);
  });
});

describe("sortExecutions", () => {
  const a = makeExecution({
    workflowId: 1,
    startedAt: new Date("2026-01-01T10:00:00Z"),
    completedAt: new Date("2026-01-01T10:05:00Z"), // 5m run
  });
  const b = makeExecution({
    workflowId: 3,
    startedAt: new Date("2026-01-02T10:00:00Z"),
    completedAt: new Date("2026-01-02T10:01:00Z"), // 1m run
  });
  const c = makeExecution({
    workflowId: 2,
    startedAt: new Date("2026-01-03T10:00:00Z"),
    completedAt: null, // still running
  });
  const executions = [a, b, c];

  it("does not mutate the input array", () => {
    const input = [...executions];
    sortExecutions(input, "startedAt", "asc", undefined);
    expect(input).toEqual(executions);
  });

  it("sorts by start time in both directions", () => {
    expect(
      sortExecutions(executions, "startedAt", "asc", undefined).map(
        (e) => e.workflowId,
      ),
    ).toEqual([1, 3, 2]);
    expect(
      sortExecutions(executions, "startedAt", "desc", undefined).map(
        (e) => e.workflowId,
      ),
    ).toEqual([2, 3, 1]);
  });

  it("sorts 'name' by workflow id", () => {
    expect(
      sortExecutions(executions, "name", "asc", undefined).map(
        (e) => e.workflowId,
      ),
    ).toEqual([1, 2, 3]);
  });

  it("sorts 'completedAt' by completion date on the all-workflows page", () => {
    // Missing completion dates sort as epoch 0 (first ascending)
    expect(
      sortExecutions(executions, "completedAt", "asc", undefined).map(
        (e) => e.workflowId,
      ),
    ).toEqual([2, 1, 3]);
  });

  it("sorts 'completedAt' by run duration on a workflow detail page", () => {
    // Durations: a=5m, b=1m, c=0 (no completion)
    expect(
      sortExecutions(executions, "completedAt", "asc", 1).map(
        (e) => e.workflowId,
      ),
    ).toEqual([2, 3, 1]);
    expect(
      sortExecutions(executions, "completedAt", "desc", 1).map(
        (e) => e.workflowId,
      ),
    ).toEqual([1, 3, 2]);
  });
});
