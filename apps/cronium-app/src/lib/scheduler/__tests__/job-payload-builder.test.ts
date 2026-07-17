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
});
