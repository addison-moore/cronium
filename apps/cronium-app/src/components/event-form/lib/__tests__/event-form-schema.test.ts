import { eventFormSchema } from "../event-form-schema";
import {
  CatchupPolicy,
  EventStatus,
  EventTriggerType,
  EventType,
  OverlapPolicy,
  RunLocation,
  TimeUnit,
} from "@/shared/schema";
import type { ToolActionConfig } from "../../ToolActionSection";

const minimalScript = {
  name: "My Event",
  type: EventType.BASH,
  content: "echo hi",
  status: EventStatus.DRAFT,
  triggerType: EventTriggerType.MANUAL,
};

function issuesAt(input: unknown, field: string): string[] {
  const result = eventFormSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => issue.path[0] === field)
    .map((issue) => issue.message);
}

describe("eventFormSchema defaults", () => {
  it("fills the schedule/execution defaults for a minimal input", () => {
    const parsed = eventFormSchema.parse(minimalScript);
    expect(parsed).toMatchObject({
      shared: false,
      scheduleNumber: 5,
      scheduleUnit: TimeUnit.MINUTES,
      useCronScheduling: false,
      timezone: "UTC",
      catchupPolicy: CatchupPolicy.SKIP,
      overlapPolicy: OverlapPolicy.ALLOW,
      priority: 1,
      timeoutValue: 30,
      timeoutUnit: TimeUnit.SECONDS,
      runLocation: RunLocation.LOCAL,
      runOnLocal: true,
      selectedServerIds: [],
      retries: 0,
      maxExecutions: 0,
      resetCounterOnActive: false,
      envVars: [],
      tags: [],
    });
  });
});

describe("eventFormSchema validation", () => {
  it("requires a name", () => {
    expect(issuesAt({ ...minimalScript, name: "" }, "name")).toContain(
      "Event name is required",
    );
  });

  it("requires content for every script type", () => {
    for (const type of [EventType.PYTHON, EventType.BASH, EventType.NODEJS]) {
      expect(
        issuesAt({ ...minimalScript, type, content: undefined }, "content"),
      ).toContain("Script content is required");
      expect(
        issuesAt({ ...minimalScript, type, content: "" }, "content"),
      ).toContain("Script content is required");
      expect(
        issuesAt({ ...minimalScript, type, content: "   \n\t" }, "content"),
      ).toContain("Script content is required");
    }
  });

  it("does not require content for HTTP or tool-action events", () => {
    expect(
      issuesAt(
        {
          ...minimalScript,
          type: EventType.HTTP_REQUEST,
          content: undefined,
          httpMethod: "GET",
          httpUrl: "https://example.com",
        },
        "content",
      ),
    ).toEqual([]);
  });

  it("requires method and URL for HTTP request events", () => {
    const http = { ...minimalScript, type: EventType.HTTP_REQUEST };
    expect(issuesAt(http, "httpUrl")).toContain(
      "HTTP method and URL are required",
    );
    expect(issuesAt({ ...http, httpMethod: "GET" }, "httpUrl")).toContain(
      "HTTP method and URL are required",
    );
    expect(
      issuesAt({ ...http, httpUrl: "https://example.com" }, "httpUrl"),
    ).toContain("HTTP method and URL are required");
    expect(
      issuesAt(
        { ...http, httpMethod: "GET", httpUrl: "https://example.com" },
        "httpUrl",
      ),
    ).toEqual([]);
  });

  it("requires a tool and action for tool-action events", () => {
    const tool = { ...minimalScript, type: EventType.TOOL_ACTION };
    expect(issuesAt(tool, "toolActionConfig")).toContain(
      "Tool and action selection is required",
    );
    expect(
      issuesAt(
        {
          ...tool,
          toolActionConfig: {
            toolType: "slack",
            toolId: 3,
            actionId: "",
            parameters: {},
          } satisfies ToolActionConfig,
        },
        "toolActionConfig",
      ),
    ).toContain("Tool and action selection is required");
    expect(
      issuesAt(
        {
          ...tool,
          toolActionConfig: {
            toolType: "slack",
            toolId: 3,
            actionId: "send-message",
            parameters: {},
          } satisfies ToolActionConfig,
        },
        "toolActionConfig",
      ),
    ).toEqual([]);
  });

  it("requires at least one execution location", () => {
    expect(
      issuesAt(
        { ...minimalScript, runOnLocal: false, selectedServerIds: [] },
        "selectedServerIds",
      ),
    ).toContain("Select at least one execution location");
    expect(
      issuesAt(
        { ...minimalScript, runOnLocal: false, selectedServerIds: [6] },
        "selectedServerIds",
      ),
    ).toEqual([]);
    expect(
      issuesAt(
        { ...minimalScript, runOnLocal: true, selectedServerIds: [] },
        "selectedServerIds",
      ),
    ).toEqual([]);
  });

  it("enforces interval and numeric bounds", () => {
    expect(
      eventFormSchema.safeParse({ ...minimalScript, scheduleNumber: 0 })
        .success,
    ).toBe(false);
    expect(
      eventFormSchema.safeParse({ ...minimalScript, retries: 11 }).success,
    ).toBe(false);
    expect(
      eventFormSchema.safeParse({ ...minimalScript, priority: 4 }).success,
    ).toBe(false);
    expect(
      eventFormSchema.safeParse({ ...minimalScript, timeoutValue: 0 }).success,
    ).toBe(false);
  });
});
