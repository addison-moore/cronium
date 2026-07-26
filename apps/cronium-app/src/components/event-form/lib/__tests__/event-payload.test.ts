import {
  buildEventPayload,
  deriveRunLocation,
  isScriptEventType,
  SCRIPT_EVENT_TYPES,
} from "../event-payload";
import { eventFormSchema, type EventFormData } from "../event-form-schema";
import { createEventSchema } from "@/shared/schemas/events";
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

const baseForm: EventFormData = {
  name: "My Event",
  description: "",
  shared: false,
  type: EventType.BASH,
  content: "echo hello",
  status: EventStatus.DRAFT,
  triggerType: EventTriggerType.SCHEDULE,
  scheduleNumber: 5,
  scheduleUnit: TimeUnit.MINUTES,
  startTime: null,
  useCronScheduling: false,
  customSchedule: "",
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
  toolActionConfig: null,
};

function makeFormData(overrides: Partial<EventFormData> = {}): EventFormData {
  return { ...baseForm, ...overrides };
}

const toolConfig: ToolActionConfig = {
  toolType: "slack",
  actionId: "send-message",
  toolId: 7,
  parameters: { channel: "#general", message: "hi" },
};

describe("isScriptEventType", () => {
  it("is true exactly for PYTHON, BASH, and NODEJS", () => {
    expect(SCRIPT_EVENT_TYPES).toEqual([
      EventType.PYTHON,
      EventType.BASH,
      EventType.NODEJS,
    ]);
    expect(isScriptEventType(EventType.PYTHON)).toBe(true);
    expect(isScriptEventType(EventType.BASH)).toBe(true);
    expect(isScriptEventType(EventType.NODEJS)).toBe(true);
    expect(isScriptEventType(EventType.HTTP_REQUEST)).toBe(false);
    expect(isScriptEventType(EventType.TOOL_ACTION)).toBe(false);
  });
});

describe("deriveRunLocation", () => {
  it("is LOCAL when no servers are selected", () => {
    expect(deriveRunLocation(true, [])).toBe(RunLocation.LOCAL);
  });

  it("is LOCAL_AND_REMOTE when local plus servers are selected", () => {
    expect(deriveRunLocation(true, [3])).toBe(RunLocation.LOCAL_AND_REMOTE);
  });

  it("is REMOTE when only servers are selected", () => {
    expect(deriveRunLocation(false, [3, 4])).toBe(RunLocation.REMOTE);
  });

  it("falls back to LOCAL when neither location is selected (form refinement blocks this state before submit)", () => {
    expect(deriveRunLocation(false, [])).toBe(RunLocation.LOCAL);
  });
});

describe("buildEventPayload", () => {
  it("strips form-only fields (useCronScheduling, runOnLocal) from the payload", () => {
    const payload = buildEventPayload(makeFormData());
    expect(payload).not.toHaveProperty("useCronScheduling");
    expect(payload).not.toHaveProperty("runOnLocal");
  });

  it("omits customSchedule in interval mode even when cron text is present", () => {
    const payload = buildEventPayload(
      makeFormData({ useCronScheduling: false, customSchedule: "*/5 * * * *" }),
    );
    expect(payload.customSchedule).toBeUndefined();
    expect(payload.scheduleNumber).toBe(5);
    expect(payload.scheduleUnit).toBe(TimeUnit.MINUTES);
  });

  it("passes customSchedule through in cron mode and leaves interval fields untouched", () => {
    const payload = buildEventPayload(
      makeFormData({
        useCronScheduling: true,
        customSchedule: "0 0 * * *",
        scheduleNumber: 42,
        scheduleUnit: TimeUnit.HOURS,
      }),
    );
    expect(payload.customSchedule).toBe("0 0 * * *");
    expect(payload.scheduleNumber).toBe(42);
    expect(payload.scheduleUnit).toBe(TimeUnit.HOURS);
  });

  it("derives runLocation from the location selection, ignoring the stale runLocation field", () => {
    expect(
      buildEventPayload(
        makeFormData({ runLocation: RunLocation.REMOTE, runOnLocal: true }),
      ).runLocation,
    ).toBe(RunLocation.LOCAL);
    expect(
      buildEventPayload(
        makeFormData({ runOnLocal: true, selectedServerIds: [6] }),
      ).runLocation,
    ).toBe(RunLocation.LOCAL_AND_REMOTE);
    expect(
      buildEventPayload(
        makeFormData({ runOnLocal: false, selectedServerIds: [6, 7] }),
      ).runLocation,
    ).toBe(RunLocation.REMOTE);
  });

  it("always nulls the deprecated serverId", () => {
    expect(buildEventPayload(makeFormData()).serverId).toBeNull();
  });

  it("keeps content for script types and drops it for non-script types", () => {
    for (const type of [EventType.PYTHON, EventType.BASH, EventType.NODEJS]) {
      expect(
        buildEventPayload(makeFormData({ type, content: "run me" })).content,
      ).toBe("run me");
    }
    expect(
      buildEventPayload(
        makeFormData({
          type: EventType.HTTP_REQUEST,
          content: "leftover",
          httpMethod: "GET",
          httpUrl: "https://example.com",
        }),
      ).content,
    ).toBeUndefined();
    expect(
      buildEventPayload(
        makeFormData({
          type: EventType.TOOL_ACTION,
          content: "leftover",
          toolActionConfig: toolConfig,
        }),
      ).content,
    ).toBeUndefined();
  });

  it("converts startTime from the datetime-local format to an ISO timestamp", () => {
    const localValue = "2026-03-01T10:30";
    const payload = buildEventPayload(makeFormData({ startTime: localValue }));
    expect(payload.startTime).toBe(new Date(localValue).toISOString());
    // ISO 8601 with milliseconds and Z suffix
    expect(payload.startTime).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("maps missing/empty startTime to null", () => {
    expect(
      buildEventPayload(makeFormData({ startTime: null })).startTime,
    ).toBeNull();
    expect(
      buildEventPayload(makeFormData({ startTime: "" })).startTime,
    ).toBeNull();
  });

  it("JSON-stringifies toolActionConfig only for tool-action events", () => {
    const toolPayload = buildEventPayload(
      makeFormData({
        type: EventType.TOOL_ACTION,
        toolActionConfig: toolConfig,
      }),
    );
    expect(toolPayload.toolActionConfig).toBe(JSON.stringify(toolConfig));

    // Config present on a non-tool event is dropped
    expect(
      buildEventPayload(makeFormData({ toolActionConfig: toolConfig }))
        .toolActionConfig,
    ).toBeUndefined();

    // Tool event without a config sends undefined
    expect(
      buildEventPayload(
        makeFormData({ type: EventType.TOOL_ACTION, toolActionConfig: null }),
      ).toolActionConfig,
    ).toBeUndefined();
  });

  it("includes httpHeaders only for HTTP request events", () => {
    const headers = [{ key: "Authorization", value: "Bearer x" }];
    const httpPayload = buildEventPayload(
      makeFormData({
        type: EventType.HTTP_REQUEST,
        httpMethod: "POST",
        httpUrl: "https://example.com/hook",
        httpHeaders: headers,
        httpBody: '{"a":1}',
      }),
    );
    expect(httpPayload.httpHeaders).toEqual(headers);
    expect(httpPayload.httpMethod).toBe("POST");
    expect(httpPayload.httpUrl).toBe("https://example.com/hook");
    expect(httpPayload.httpBody).toBe('{"a":1}');

    // Script event with leftover header rows never sends them
    expect(
      buildEventPayload(makeFormData({ httpHeaders: headers })),
    ).not.toHaveProperty("httpHeaders");

    // HTTP event with no header rows omits the field (server defaults to [])
    expect(
      buildEventPayload(
        makeFormData({
          type: EventType.HTTP_REQUEST,
          httpMethod: "GET",
          httpUrl: "https://example.com",
          httpHeaders: undefined,
        }),
      ),
    ).not.toHaveProperty("httpHeaders");
  });

  it("passes envVars and tags through as arrays", () => {
    const envVars = [{ key: "API_KEY", value: "secret" }];
    const tags = ["nightly", "reports"];
    const payload = buildEventPayload(makeFormData({ envVars, tags }));
    expect(payload.envVars).toEqual(envVars);
    expect(payload.tags).toEqual(tags);
  });

  it("passes scheduling policies and priority through unchanged", () => {
    const payload = buildEventPayload(
      makeFormData({
        timezone: "Europe/Berlin",
        catchupPolicy: CatchupPolicy.RUN_ONCE,
        overlapPolicy: OverlapPolicy.QUEUE,
        priority: 3,
      }),
    );
    expect(payload.timezone).toBe("Europe/Berlin");
    expect(payload.catchupPolicy).toBe(CatchupPolicy.RUN_ONCE);
    expect(payload.overlapPolicy).toBe(OverlapPolicy.QUEUE);
    expect(payload.priority).toBe(3);
  });
});

describe("buildEventPayload vs server createEventSchema (mirror tests)", () => {
  it("a typical interval-mode script payload parses server-side", () => {
    const payload = buildEventPayload(makeFormData());
    const result = createEventSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("a typical cron-mode payload parses server-side", () => {
    const payload = buildEventPayload(
      makeFormData({ useCronScheduling: true, customSchedule: "*/5 * * * *" }),
    );
    expect(createEventSchema.safeParse(payload).success).toBe(true);
  });

  it("an invalid cron expression is rejected server-side", () => {
    const payload = buildEventPayload(
      makeFormData({ useCronScheduling: true, customSchedule: "not a cron" }),
    );
    const result = createEventSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path[0] === "customSchedule"),
      ).toBe(true);
    }
  });

  describe("interval minimum (10s floor, enforced server-side only)", () => {
    const scheduled = (n: number, unit: TimeUnit) =>
      buildEventPayload(
        makeFormData({
          triggerType: EventTriggerType.SCHEDULE,
          scheduleNumber: n,
          scheduleUnit: unit,
        }),
      );

    it("rejects sub-10-second intervals for scheduled events", () => {
      for (const n of [1, 5, 9]) {
        const result = createEventSchema.safeParse(
          scheduled(n, TimeUnit.SECONDS),
        );
        expect(result.success).toBe(false);
        if (!result.success) {
          const issue = result.error.issues.find(
            (i) => i.path[0] === "scheduleNumber",
          );
          expect(issue?.message).toBe(
            "Intervals below 10 seconds are not supported",
          );
        }
      }
    });

    it("accepts the 10-second boundary and larger units", () => {
      expect(
        createEventSchema.safeParse(scheduled(10, TimeUnit.SECONDS)).success,
      ).toBe(true);
      expect(
        createEventSchema.safeParse(scheduled(1, TimeUnit.MINUTES)).success,
      ).toBe(true);
      expect(
        createEventSchema.safeParse(scheduled(1, TimeUnit.HOURS)).success,
      ).toBe(true);
      expect(
        createEventSchema.safeParse(scheduled(1, TimeUnit.DAYS)).success,
      ).toBe(true);
    });

    it("skips the interval floor in cron mode (cron takes precedence)", () => {
      const payload = buildEventPayload(
        makeFormData({
          useCronScheduling: true,
          customSchedule: "*/5 * * * *",
          scheduleNumber: 5,
          scheduleUnit: TimeUnit.SECONDS,
        }),
      );
      expect(createEventSchema.safeParse(payload).success).toBe(true);
    });

    it("skips the interval floor for manual events", () => {
      const payload = buildEventPayload(
        makeFormData({
          triggerType: EventTriggerType.MANUAL,
          scheduleNumber: 5,
          scheduleUnit: TimeUnit.SECONDS,
        }),
      );
      expect(createEventSchema.safeParse(payload).success).toBe(true);
    });

    it("documents the client/server gap: the form schema itself allows a sub-10s interval", () => {
      // The client-side eventFormSchema only enforces scheduleNumber >= 1;
      // the 10s floor surfaces as a server error toast, not inline.
      const formResult = eventFormSchema.safeParse(
        makeFormData({
          scheduleNumber: 5,
          scheduleUnit: TimeUnit.SECONDS,
        }),
      );
      expect(formResult.success).toBe(true);
    });
  });

  it("documents the client/server gap: the form allows names longer than the server's 100-char cap", () => {
    const longName = "n".repeat(101);
    expect(
      eventFormSchema.safeParse(makeFormData({ name: longName })).success,
    ).toBe(true);
    expect(
      createEventSchema.safeParse(
        buildEventPayload(makeFormData({ name: longName })),
      ).success,
    ).toBe(false);
  });

  it("a tool-action payload parses server-side (config as JSON string)", () => {
    const payload = buildEventPayload(
      makeFormData({
        type: EventType.TOOL_ACTION,
        toolActionConfig: toolConfig,
      }),
    );
    const result = createEventSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.toolActionConfig).toBe("string");
    }
  });

  it("an HTTP payload parses server-side", () => {
    const payload = buildEventPayload(
      makeFormData({
        type: EventType.HTTP_REQUEST,
        httpMethod: "GET",
        httpUrl: "https://example.com/data",
        httpHeaders: [{ key: "Accept", value: "application/json" }],
      }),
    );
    expect(createEventSchema.safeParse(payload).success).toBe(true);
  });

  it("a payload with a converted startTime parses server-side (.datetime())", () => {
    const payload = buildEventPayload(
      makeFormData({ startTime: "2026-03-01T10:30" }),
    );
    expect(createEventSchema.safeParse(payload).success).toBe(true);
  });
});
