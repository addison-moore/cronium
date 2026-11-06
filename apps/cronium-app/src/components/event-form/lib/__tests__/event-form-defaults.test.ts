import {
  buildEventFormDefaults,
  buildTimezoneOptions,
  extractServerIds,
  linkedServers,
  parseInitialEnvVars,
  parseInitialHttpHeaders,
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

  it("converts startTime to the datetime-local format (minute precision)", () => {
    const defaults = buildEventFormDefaults({
      startTime: new Date("2026-03-05T12:34:56.789Z"),
    });
    // Which time it shows depends on the zone, which start-time.test.ts sets.
    expect(defaults.startTime).toMatch(/^2026-03-0[56]T\d{2}:\d{2}$/);
  });

  it("normalizes the lowercase values older rows can hold", () => {
    const defaults = buildEventFormDefaults({
      scheduleUnit: "hours" as TimeUnit,
      timeoutUnit: "minutes" as TimeUnit,
      runLocation: "remote" as RunLocation,
    });
    expect(defaults.scheduleUnit).toBe(TimeUnit.HOURS);
    expect(defaults.timeoutUnit).toBe(TimeUnit.MINUTES);
    expect(defaults.runLocation).toBe(RunLocation.REMOTE);
    expect(defaults.runOnLocal).toBe(false);
  });

  it("falls back to the defaults for a value that isn't a known one", () => {
    const defaults = buildEventFormDefaults({
      scheduleUnit: "fortnights" as TimeUnit,
      timeoutUnit: "fortnights" as TimeUnit,
      runLocation: "moon" as RunLocation,
    });
    expect(defaults.scheduleUnit).toBe(TimeUnit.MINUTES);
    expect(defaults.timeoutUnit).toBe(TimeUnit.SECONDS);
    expect(defaults.runLocation).toBe(RunLocation.LOCAL);
    expect(defaults.runOnLocal).toBe(true);
  });

  it("carries the event's servers, env vars and tags", () => {
    const defaults = buildEventFormDefaults({
      environmentVariables: [{ key: "A", value: "1" }],
      servers: [{ id: 6, name: "sandbox", address: "192.0.2.10" }],
      tags: ["x"],
    });
    expect(defaults.selectedServerIds).toEqual([6]);
    expect(defaults.envVars).toEqual([{ key: "A", value: "1" }]);
    expect(defaults.tags).toEqual(["x"]);
  });

  it("reads env vars under the name the API gives them, leaving out the rest of the row", () => {
    const defaults = buildEventFormDefaults({
      envVars: [{ id: 1, eventId: 2, key: "A", value: "1" }],
    } as never);
    expect(defaults.envVars).toEqual([{ key: "A", value: "1" }]);
  });

  it("keeps a direct server selected where a run goes to it", () => {
    const direct = { id: 9, name: "direct", address: "192.0.2.20" };
    const defaults = buildEventFormDefaults({
      runLocation: RunLocation.REMOTE,
      servers: [],
      server: direct,
    });
    expect(defaults.selectedServerIds).toEqual([9]);
  });

  it("reads a stored tool action config whichever way it was encoded", () => {
    const config = {
      toolType: "SLACK",
      toolId: 1,
      actionId: "a",
      parameters: {},
    };
    const asRead = (toolActionConfig: unknown) =>
      buildEventFormDefaults({ toolActionConfig } as never).toolActionConfig;

    expect(asRead(config)).toEqual(config);
    expect(asRead(JSON.stringify(config))).toEqual(config);
    expect(asRead(JSON.stringify(JSON.stringify(config)))).toEqual(config);
    expect(asRead("not json")).toBeNull();
    expect(asRead(undefined)).toBeNull();
  });

  describe("content", () => {
    it.each([
      ["no stored script", null],
      ["an empty one", ""],
    ])("is the event type's template with %s", (_name, content) => {
      expect(
        buildEventFormDefaults({ type: EventType.BASH, content }).content,
      ).toBe(getDefaultScriptContent(EventType.BASH));
    });

    it("is what's stored when there is a script", () => {
      expect(
        buildEventFormDefaults({ type: EventType.BASH, content: "echo hi" })
          .content,
      ).toBe("echo hi");
    });
  });

  describe("HTTP fields", () => {
    const http = {
      httpMethod: "POST",
      httpUrl: "https://example.test/hook",
      httpHeaders: [{ key: "X-Key", value: "v" }],
      httpBody: '{"a":1}',
    };

    it("carries them for an HTTP request", () => {
      expect(
        buildEventFormDefaults({ type: EventType.HTTP_REQUEST, ...http }),
      ).toEqual(expect.objectContaining(http));
    });

    it("carries them for an event of another type that still has them", () => {
      expect(buildEventFormDefaults({ type: EventType.BASH, ...http })).toEqual(
        expect.objectContaining(http),
      );
    });

    it("fills the gaps in what's stored", () => {
      const defaults = buildEventFormDefaults({
        httpMethod: "GET",
        httpUrl: null,
        httpHeaders: null,
        httpBody: null,
      });
      expect(defaults.httpUrl).toBe("");
      expect(defaults.httpHeaders).toEqual([]);
      expect(defaults.httpBody).toBe("");
    });

    it("leaves them out of an event that never had any", () => {
      const defaults = buildEventFormDefaults({ type: EventType.BASH });
      expect(defaults).not.toHaveProperty("httpMethod");
      expect(defaults).not.toHaveProperty("httpUrl");
      expect(defaults).not.toHaveProperty("httpHeaders");
      expect(defaults).not.toHaveProperty("httpBody");
    });
  });

  // The form compares these on every render, and a difference would count as a change.
  it("gives equal values for equal events, however they were built", () => {
    const event = () => ({
      name: "n",
      startTime: new Date("2026-03-05T12:34:56.789Z"),
      environmentVariables: [{ key: "A", value: "1" }],
      servers: [{ id: 6, name: "sandbox", address: "192.0.2.10" }],
      tags: ["x"],
      toolActionConfig: { toolType: "SLACK", toolId: 1, actionId: "a" },
      httpMethod: "GET",
      httpHeaders: [{ key: "X-Key", value: "v" }],
    });
    expect(buildEventFormDefaults(event())).toEqual(
      buildEventFormDefaults(event()),
    );
  });
});

describe("parseInitialHttpHeaders", () => {
  it("keeps headers the form can hold", () => {
    const headers = [{ key: "X-Key", value: "v" }];
    expect(parseInitialHttpHeaders(headers)).toEqual(headers);
  });

  it("leaves out anything the form's schema would refuse", () => {
    expect(
      parseInitialHttpHeaders([
        { key: "X-Key", value: "v" },
        { key: "X-Number", value: 1 },
        { value: "no key" },
        null,
        "X-String",
      ]),
    ).toEqual([{ key: "X-Key", value: "v" }]);
  });

  it("gives an empty list for anything that isn't a list", () => {
    expect(parseInitialHttpHeaders(null)).toEqual([]);
    expect(parseInitialHttpHeaders(undefined)).toEqual([]);
    expect(parseInitialHttpHeaders({ "X-Key": "v" })).toEqual([]);
    expect(parseInitialHttpHeaders("[]")).toEqual([]);
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

  it("keeps only the key and value of a row from the API", () => {
    const row = {
      id: 7,
      eventId: 42,
      key: "K",
      value: "V",
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
      updatedAt: new Date("2026-01-02T03:04:05.000Z"),
    };
    expect(parseInitialEnvVars([row])).toEqual([{ key: "K", value: "V" }]);
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

describe("linkedServers", () => {
  const live = { id: 6, name: "live-box", address: "192.0.2.10" };
  const retired = {
    id: 7,
    name: "retired-box",
    address: "192.0.2.20",
    isArchived: true,
  };

  it("is empty for a new event", () => {
    expect(linkedServers(undefined)).toEqual([]);
    expect(linkedServers({})).toEqual([]);
  });

  it("returns an event's links, archived or not", () => {
    expect(linkedServers({ servers: [live, retired] })).toEqual([
      live,
      retired,
    ]);
  });

  it("adds an archived direct server, once", () => {
    const remote = { runLocation: RunLocation.REMOTE, server: retired };
    expect(linkedServers({ ...remote, servers: [live] })).toEqual([
      live,
      retired,
    ]);
    expect(linkedServers({ ...remote, servers: [retired] })).toEqual([retired]);
  });

  it("adds an archived direct server on a LOCAL_AND_REMOTE event too", () => {
    expect(
      linkedServers({
        runLocation: RunLocation.LOCAL_AND_REMOTE,
        server: retired,
        servers: [],
      }),
    ).toEqual([retired]);
  });

  describe("with an active direct server", () => {
    const other = { id: 8, name: "other-box", address: "192.0.2.30" };

    it("adds it when an event has no links", () => {
      for (const runLocation of [
        RunLocation.REMOTE,
        RunLocation.LOCAL_AND_REMOTE,
      ]) {
        expect(
          linkedServers({ runLocation, server: live, servers: [] }),
        ).toEqual([live]);
      }
    });

    it("lists a server once when it's also a link", () => {
      const onBoth = { server: live, servers: [live, other] };
      expect(
        linkedServers({ ...onBoth, runLocation: RunLocation.REMOTE }),
      ).toEqual([live, other]);
      expect(
        linkedServers({
          runLocation: RunLocation.LOCAL_AND_REMOTE,
          server: live,
          servers: [live],
        }),
      ).toEqual([live]);
    });

    // Where a job really goes: tests/storage/event-save-direct-server.test.ts.
    it("takes it over a lone link on a REMOTE event, where a run goes to it", () => {
      expect(
        linkedServers({
          runLocation: RunLocation.REMOTE,
          server: live,
          servers: [other],
        }),
      ).toEqual([live]);
    });

    it("leaves it out when a run fans out to the links without it", () => {
      expect(
        linkedServers({
          runLocation: RunLocation.REMOTE,
          server: live,
          servers: [other, retired],
        }),
      ).toEqual([other, retired]);
      expect(
        linkedServers({
          runLocation: RunLocation.LOCAL_AND_REMOTE,
          server: live,
          servers: [other],
        }),
      ).toEqual([other]);
    });

    it("keeps an archived link beside it, because that link stops the event", () => {
      expect(
        linkedServers({
          runLocation: RunLocation.REMOTE,
          server: live,
          servers: [retired],
        }),
      ).toEqual([live, retired]);
    });
  });

  it("leaves out a direct server on a LOCAL event, active or archived", () => {
    for (const server of [live, retired]) {
      expect(
        linkedServers({ runLocation: RunLocation.LOCAL, server, servers: [] }),
      ).toEqual([]);
      expect(linkedServers({ server, servers: [] })).toEqual([]);
    }
  });

  it("reads a location stored in lowercase by older rows", () => {
    const stored = (runLocation: string) =>
      linkedServers({
        runLocation: runLocation as RunLocation,
        server: live,
        servers: [],
      });

    expect(stored("local")).toEqual([]);
    expect(stored("remote")).toEqual([live]);
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
