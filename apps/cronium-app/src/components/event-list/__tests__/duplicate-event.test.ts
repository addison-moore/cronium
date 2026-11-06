/**
 * What Duplicate sends has to get through the real events.create schema, which
 * strips what it doesn't know: serverIds used to go that way, and the schema then
 * refused a REMOTE copy for having no servers.
 */
import { EventStatus, EventType, RunLocation } from "@/shared/schema";
import { createEventSchema } from "@/shared/schemas/events";
import { buildDuplicateEventInput } from "../duplicate-event";
import type { Event } from "../types";

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 1,
    name: "Nightly job",
    userId: "user-1",
    description: null,
    type: EventType.BASH,
    status: EventStatus.ACTIVE,
    content: "echo hi",
    scheduleNumber: 5,
    scheduleUnit: "MINUTES",
    customSchedule: null,
    createdAt: "2026-11-05T00:00:00.000Z",
    updatedAt: "2026-11-05T00:00:00.000Z",
    lastRunAt: null,
    nextRunAt: null,
    runLocation: RunLocation.LOCAL,
    ...overrides,
  };
}

function parsed(event: Event) {
  return createEventSchema.parse(buildDuplicateEventInput(event));
}

describe("buildDuplicateEventInput", () => {
  it("makes a draft named as a copy", () => {
    const copy = parsed(makeEvent({ tags: ["a"], shared: true }));

    expect(copy).toMatchObject({
      name: "Nightly job (copy)",
      status: EventStatus.DRAFT,
      type: EventType.BASH,
      content: "echo hi",
      tags: ["a"],
      shared: true,
      scheduleNumber: 5,
    });
  });

  describe("server links", () => {
    it.each([RunLocation.REMOTE, RunLocation.LOCAL_AND_REMOTE])(
      "keeps the links of a %s event, under the name the schema reads",
      (runLocation) => {
        const event = makeEvent({ runLocation, eventServers: [6, 7] });

        expect(parsed(event)).toMatchObject({
          runLocation,
          selectedServerIds: [6, 7],
        });
        expect(buildDuplicateEventInput(event)).not.toHaveProperty("serverIds");
      },
    );

    it("keeps a direct server", () => {
      const copy = parsed(
        makeEvent({ runLocation: RunLocation.REMOTE, serverId: 9 }),
      );

      expect(copy).toMatchObject({ serverId: 9, selectedServerIds: [] });
    });

    it("still lets the schema refuse a REMOTE event with no servers at all", () => {
      const result = createEventSchema.safeParse(
        buildDuplicateEventInput(
          makeEvent({ runLocation: RunLocation.REMOTE, eventServers: [] }),
        ),
      );

      expect(result.success).toBe(false);
    });

    it("leaves out a LOCAL event's stale links, which the copy wouldn't keep", () => {
      const event = makeEvent({
        runLocation: RunLocation.LOCAL,
        eventServers: [6],
      });

      expect(buildDuplicateEventInput(event)).not.toHaveProperty(
        "selectedServerIds",
      );
      expect(parsed(event).selectedServerIds).toEqual([]);
    });
  });

  describe("tool actions", () => {
    const config = { toolType: "EMAIL", toolId: 3, actionId: "send" };

    it("sends a config stored as an object as the string the schema takes", () => {
      const copy = parsed(
        makeEvent({
          type: EventType.TOOL_ACTION,
          content: null,
          toolActionConfig: config,
        }),
      );

      expect(JSON.parse(copy.toolActionConfig!)).toEqual(config);
    });

    it("leaves a config stored as a string as it is", () => {
      const stored = JSON.stringify(config);
      const copy = parsed(
        makeEvent({
          type: EventType.TOOL_ACTION,
          content: null,
          toolActionConfig: stored,
        }),
      );

      expect(copy.toolActionConfig).toBe(stored);
    });
  });

  it("carries an HTTP request's fields", () => {
    const copy = parsed(
      makeEvent({
        type: EventType.HTTP_REQUEST,
        content: null,
        httpMethod: "POST",
        httpUrl: "https://example.test/hook",
        httpHeaders: [{ key: "X-A", value: "1" }],
        httpBody: "{}",
      }),
    );

    expect(copy).toMatchObject({
      httpMethod: "POST",
      httpUrl: "https://example.test/hook",
      httpHeaders: [{ key: "X-A", value: "1" }],
      httpBody: "{}",
    });
  });
});
