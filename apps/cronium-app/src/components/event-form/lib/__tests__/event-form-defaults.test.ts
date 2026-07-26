import {
  buildEventFormDefaults,
  buildTimezoneOptions,
  extractServerIds,
  parseInitialEnvVars,
  parseInitialTags,
} from "../event-form-defaults";
import { getDefaultScriptContent } from "@/lib/scriptTemplates";
import {
  CatchupPolicy,
  EventStatus,
  EventTriggerType,
  EventType,
  OverlapPolicy,
  RunLocation,
  TimeUnit,
} from "@/shared/schema";

describe("buildEventFormDefaults", () => {
  it("resolves the documented defaults with no initial data", () => {
    const defaults = buildEventFormDefaults(undefined);
    expect(defaults).toMatchObject({
      name: "",
      description: "",
      shared: false,
      type: EventType.PYTHON,
      content: getDefaultScriptContent(EventType.PYTHON),
      status: EventStatus.DRAFT,
      triggerType: EventTriggerType.MANUAL,
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
    });
  });

  it("prefers initial data over defaults for provided fields", () => {
    const defaults = buildEventFormDefaults({
      name: "Nightly Sync",
      type: EventType.BASH,
      content: "echo hi",
      status: EventStatus.ACTIVE,
      triggerType: EventTriggerType.SCHEDULE,
      scheduleNumber: 12,
      scheduleUnit: TimeUnit.HOURS,
      timezone: "Europe/Berlin",
      priority: 2,
      retries: 3,
    });
    expect(defaults.name).toBe("Nightly Sync");
    expect(defaults.type).toBe(EventType.BASH);
    expect(defaults.content).toBe("echo hi");
    expect(defaults.status).toBe(EventStatus.ACTIVE);
    expect(defaults.triggerType).toBe(EventTriggerType.SCHEDULE);
    expect(defaults.scheduleNumber).toBe(12);
    expect(defaults.scheduleUnit).toBe(TimeUnit.HOURS);
    expect(defaults.timezone).toBe("Europe/Berlin");
    expect(defaults.priority).toBe(2);
    expect(defaults.retries).toBe(3);
  });

  it("derives cron mode from the presence of a custom schedule", () => {
    expect(buildEventFormDefaults({}).useCronScheduling).toBe(false);
    const cron = buildEventFormDefaults({ customSchedule: "0 0 * * *" });
    expect(cron.useCronScheduling).toBe(true);
    expect(cron.customSchedule).toBe("0 0 * * *");
  });

  it("derives runOnLocal: false only for remote-only events", () => {
    expect(buildEventFormDefaults(undefined).runOnLocal).toBe(true);
    expect(
      buildEventFormDefaults({ runLocation: RunLocation.LOCAL }).runOnLocal,
    ).toBe(true);
    expect(
      buildEventFormDefaults({ runLocation: RunLocation.LOCAL_AND_REMOTE })
        .runOnLocal,
    ).toBe(true);
    expect(
      buildEventFormDefaults({ runLocation: RunLocation.REMOTE }).runOnLocal,
    ).toBe(false);
  });

  it("converts startTime to the datetime-local format (UTC, minute precision)", () => {
    const defaults = buildEventFormDefaults({
      startTime: new Date("2026-03-05T12:34:56.789Z"),
    });
    expect(defaults.startTime).toBe("2026-03-05T12:34");
  });

  it("never carries servers/env vars/tags into defaults (set later by effect)", () => {
    const defaults = buildEventFormDefaults({
      environmentVariables: [{ key: "A", value: "1" }],
      servers: [{ id: 6, name: "sandbox" }],
      tags: ["x"],
    });
    expect(defaults.selectedServerIds).toEqual([]);
    expect(defaults.envVars).toEqual([]);
    expect(defaults.tags).toEqual([]);
  });
});

describe("parseInitialTags", () => {
  it("returns null when there is nothing to set", () => {
    expect(parseInitialTags(undefined)).toBeNull();
    expect(parseInitialTags(null)).toBeNull();
    expect(parseInitialTags("")).toBeNull();
    expect(parseInitialTags(42)).toBeNull();
  });

  it("parses a JSON-encoded string", () => {
    expect(parseInitialTags('["a","b"]')).toEqual(["a", "b"]);
  });

  it("resets to [] on a malformed JSON string", () => {
    expect(parseInitialTags("not-json")).toEqual([]);
  });

  it("passes an array through unchanged", () => {
    expect(parseInitialTags(["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("parseInitialEnvVars", () => {
  it("returns null when there is nothing to set", () => {
    expect(parseInitialEnvVars(undefined)).toBeNull();
    expect(parseInitialEnvVars(null)).toBeNull();
    expect(parseInitialEnvVars("")).toBeNull();
  });

  it("parses a JSON-encoded string", () => {
    expect(parseInitialEnvVars('[{"key":"K","value":"V"}]')).toEqual([
      { key: "K", value: "V" },
    ]);
  });

  it("resets to [] on a malformed JSON string", () => {
    expect(parseInitialEnvVars("{broken")).toEqual([]);
  });

  it("passes an array through unchanged", () => {
    const vars = [{ key: "K", value: "V" }];
    expect(parseInitialEnvVars(vars)).toEqual(vars);
  });
});

describe("extractServerIds", () => {
  it("maps servers to their ids", () => {
    expect(
      extractServerIds([
        { id: 6, name: "a" },
        { id: 7, name: "b" },
      ]),
    ).toEqual([6, 7]);
  });

  it("filters out non-numeric ids defensively", () => {
    const servers = [
      { id: 6, name: "a" },
      { id: "7", name: "b" },
    ] as unknown as Array<{ id: number; name: string }>;
    expect(extractServerIds(servers)).toEqual([6]);
  });
});

describe("buildTimezoneOptions", () => {
  it("puts UTC first and includes the curated zones", () => {
    const options = buildTimezoneOptions();
    expect(options[0]).toBe("UTC");
    expect(options).toEqual(
      expect.arrayContaining([
        "America/New_York",
        "Europe/Berlin",
        "Asia/Tokyo",
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ]),
    );
  });

  it("contains no duplicates", () => {
    const options = buildTimezoneOptions();
    expect(new Set(options).size).toBe(options.length);
  });
});
