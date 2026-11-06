import { buildJobPayload } from "../job-payload-builder";
import { EventType, RunLocation } from "@/shared/schema";
import type { EventWithRelations } from "@/server/storage";

function makeEvent(
  overrides: Partial<EventWithRelations> = {},
): EventWithRelations {
  return {
    id: 1,
    type: EventType.BASH,
    content: "echo hi",
    runLocation: RunLocation.LOCAL,
    serverId: null,
    servers: [],
    envVars: [],
    ...overrides,
  } as unknown as EventWithRelations;
}

describe("buildJobPayload targets", () => {
  it("LOCAL events target a container", () => {
    const payload = buildJobPayload(makeEvent(), 10);
    expect(payload.target).toEqual({ containerImage: "cronium/bash:latest" });
  });

  it("REMOTE events target the first server without runOnLocal", () => {
    const payload = buildJobPayload(
      makeEvent({
        runLocation: RunLocation.REMOTE,
        servers: [{ id: 6 }, { id: 7 }] as EventWithRelations["servers"],
      }),
      10,
    );
    expect(payload.target).toEqual({ serverId: 6 });
  });

  it("LOCAL_AND_REMOTE events target the first server and set runOnLocal", () => {
    const payload = buildJobPayload(
      makeEvent({
        runLocation: RunLocation.LOCAL_AND_REMOTE,
        servers: [{ id: 6 }] as EventWithRelations["servers"],
      }),
      10,
    );
    expect(payload.target).toEqual({ serverId: 6, runOnLocal: true });
  });

  it("LOCAL_AND_REMOTE with a legacy serverId also sets runOnLocal", () => {
    const payload = buildJobPayload(
      makeEvent({
        runLocation: RunLocation.LOCAL_AND_REMOTE,
        serverId: 42,
      }),
      10,
    );
    expect(payload.target).toEqual({ serverId: 42, runOnLocal: true });
  });

  it("LOCAL_AND_REMOTE without servers falls back to a container", () => {
    const payload = buildJobPayload(
      makeEvent({ runLocation: RunLocation.LOCAL_AND_REMOTE }),
      10,
    );
    expect(payload.target).toEqual({ containerImage: "cronium/bash:latest" });
  });

  it("REMOTE with a legacy serverId targets it", () => {
    const payload = buildJobPayload(
      makeEvent({ runLocation: RunLocation.REMOTE, serverId: 42 }),
      10,
    );
    expect(payload.target).toEqual({ serverId: 42 });
  });

  it("a LOCAL event doesn't target a server it still has a stale link to", () => {
    const payload = buildJobPayload(
      makeEvent({
        runLocation: RunLocation.LOCAL,
        serverId: 42,
        servers: [{ id: 6 }] as EventWithRelations["servers"],
      }),
      10,
    );
    expect(payload.target).toEqual({ containerImage: "cronium/bash:latest" });
  });

  describe("a REMOTE event with no servers", () => {
    it("refuses a script rather than sending it to a container", () => {
      expect(() =>
        buildJobPayload(makeEvent({ runLocation: RunLocation.REMOTE }), 10),
      ).toThrow(
        "Event 1: This event runs only on servers and has none. Choose a server, or set it to run locally.",
      );
    });

    it("still builds an HTTP request, which runs in the worker", () => {
      const payload = buildJobPayload(
        makeEvent({
          type: EventType.HTTP_REQUEST,
          runLocation: RunLocation.REMOTE,
          httpMethod: "GET",
          httpUrl: "https://example.test/hook",
        }),
        10,
      );
      expect(payload.target).toEqual({
        containerImage: "cronium/http-client:latest",
      });
    });

    it("still builds a tool action, which runs in the worker", () => {
      const payload = buildJobPayload(
        makeEvent({
          type: EventType.TOOL_ACTION,
          runLocation: RunLocation.REMOTE,
          toolActionConfig: JSON.stringify({ toolType: "SLACK" }),
        } as Partial<EventWithRelations>),
        10,
      );
      expect(payload.target).toEqual({
        containerImage: "cronium/tool-executor:latest",
      });
    });
  });
});

describe("buildJobPayload environment secrecy (ME-02/ME-11)", () => {
  // The dispatch load path reads env_vars via a Drizzle relational query that
  // does NOT decrypt, so envVar.value is the at-rest ciphertext. buildJobPayload
  // must pass it through verbatim so the persisted jobs.payload never holds a
  // plaintext secret; decryption happens later, only at the delivery boundary.
  it("passes env values through verbatim, keeping the plaintext canary out of the payload", () => {
    const CANARY = "canary-SUPER-SECRET-do-not-persist";
    const ciphertext = "crn.1.k0.aXY.Y3Q.dGFn"; // stand-in at-rest envelope
    const payload = buildJobPayload(
      makeEvent({
        envVars: [
          { key: "API_KEY", value: ciphertext },
        ] as unknown as EventWithRelations["envVars"],
      }),
      10,
    );

    expect(payload.environment).toEqual({ API_KEY: ciphertext });
    // The canary plaintext must appear nowhere in the serialized persisted job.
    expect(JSON.stringify(payload)).not.toContain(CANARY);
  });
});
