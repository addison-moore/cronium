import { EventStatus, EventType, RunLocation } from "../schema";
import {
  canRunWithoutServers,
  isStrandedRemoteEvent,
  runsInProcess,
  saveStrandsEvent,
} from "../event-servers";

const script = {
  type: EventType.BASH,
  runLocation: RunLocation.REMOTE,
  status: EventStatus.ACTIVE,
  serverId: null,
  servers: [],
};
const onServer = { ...script, servers: [{ id: 5 }] };

describe("runsInProcess", () => {
  it.each([EventType.HTTP_REQUEST, EventType.TOOL_ACTION])(
    "is true for %s, which runs in the worker",
    (type) => {
      expect(runsInProcess(type)).toBe(true);
    },
  );

  it.each([EventType.BASH, EventType.NODEJS, EventType.PYTHON])(
    "is false for %s",
    (type) => {
      expect(runsInProcess(type)).toBe(false);
    },
  );
});

describe("canRunWithoutServers", () => {
  it("is false only for a script that runs only on servers", () => {
    expect(canRunWithoutServers(script)).toBe(false);
  });

  it.each([RunLocation.LOCAL, RunLocation.LOCAL_AND_REMOTE])(
    "is true for a %s script",
    (runLocation) => {
      expect(canRunWithoutServers({ ...script, runLocation })).toBe(true);
    },
  );

  it.each([EventType.HTTP_REQUEST, EventType.TOOL_ACTION])(
    "is true for a REMOTE %s",
    (type) => {
      expect(canRunWithoutServers({ ...script, type })).toBe(true);
    },
  );
});

describe("isStrandedRemoteEvent", () => {
  it("is true for a REMOTE script with no servers", () => {
    expect(isStrandedRemoteEvent(script)).toBe(true);
  });

  it("treats a missing servers list as no servers", () => {
    expect(
      isStrandedRemoteEvent({
        type: EventType.BASH,
        runLocation: RunLocation.REMOTE,
      }),
    ).toBe(true);
  });

  it("is false with a direct server", () => {
    expect(isStrandedRemoteEvent({ ...script, serverId: 5 })).toBe(false);
  });

  it("is false with a linked server", () => {
    expect(isStrandedRemoteEvent(onServer)).toBe(false);
  });

  it("is false for what can still run without servers", () => {
    expect(
      isStrandedRemoteEvent({
        ...script,
        runLocation: RunLocation.LOCAL_AND_REMOTE,
      }),
    ).toBe(false);
    expect(
      isStrandedRemoteEvent({ ...script, type: EventType.HTTP_REQUEST }),
    ).toBe(false);
  });
});

describe("saveStrandsEvent", () => {
  describe("a save that would leave an event with no servers", () => {
    it("refuses removing the last linked server", () => {
      expect(saveStrandsEvent(onServer, { selectedServerIds: [] })).toBe(true);
    });

    it("refuses clearing the only direct server", () => {
      expect(
        saveStrandsEvent({ ...script, serverId: 5 }, { serverId: null }),
      ).toBe(true);
    });

    it.each([RunLocation.REMOTE, RunLocation.LOCAL_AND_REMOTE])(
      "refuses moving a local event to %s, as events.create does",
      (runLocation) => {
        expect(
          saveStrandsEvent(
            { ...script, runLocation: RunLocation.LOCAL },
            { runLocation },
          ),
        ).toBe(true);
      },
    );

    it("applies to HTTP requests too when the save changes where they run", () => {
      expect(
        saveStrandsEvent(
          { ...onServer, type: EventType.HTTP_REQUEST },
          { selectedServerIds: [] },
        ),
      ).toBe(true);
    });

    it("refuses turning an event that can run without servers into one that can't", () => {
      expect(
        saveStrandsEvent(
          { ...script, type: EventType.HTTP_REQUEST },
          { type: EventType.BASH },
        ),
      ).toBe(true);
    });
  });

  describe("a save that leaves the event with a server", () => {
    it("allows adding a linked server", () => {
      expect(saveStrandsEvent(script, { selectedServerIds: [5] })).toBe(false);
    });

    it("allows swapping a direct server for linked ones, as the form does", () => {
      expect(
        saveStrandsEvent(
          { ...script, serverId: 5 },
          { serverId: null, selectedServerIds: [6] },
        ),
      ).toBe(false);
    });

    it("allows clearing a direct server when a linked one stays", () => {
      expect(
        saveStrandsEvent({ ...onServer, serverId: 6 }, { serverId: null }),
      ).toBe(false);
    });

    it("allows activating it", () => {
      expect(
        saveStrandsEvent(
          { ...onServer, status: EventStatus.PAUSED },
          { status: EventStatus.ACTIVE },
        ),
      ).toBe(false);
    });
  });

  describe("a save that makes it local", () => {
    it("allows it, as the form sends it", () => {
      expect(
        saveStrandsEvent(onServer, {
          runLocation: RunLocation.LOCAL,
          serverId: null,
          selectedServerIds: [],
        }),
      ).toBe(false);
    });
  });

  describe("a row already with no servers", () => {
    const paused = { ...script, status: EventStatus.PAUSED };

    it("still takes an edit that doesn't touch where it runs", () => {
      expect(saveStrandsEvent(paused, {})).toBe(false);
    });

    it("still takes a client sending its unchanged fields back", () => {
      expect(
        saveStrandsEvent(paused, {
          runLocation: RunLocation.REMOTE,
          serverId: null,
          selectedServerIds: [],
          status: EventStatus.PAUSED,
        }),
      ).toBe(false);
    });

    it("doesn't count an active row staying active as activating it", () => {
      expect(saveStrandsEvent(script, { status: EventStatus.ACTIVE })).toBe(
        false,
      );
    });

    it("refuses activating it", () => {
      expect(saveStrandsEvent(paused, { status: EventStatus.ACTIVE })).toBe(
        true,
      );
    });

    it("refuses moving it to LOCAL_AND_REMOTE, which also needs a server to save", () => {
      expect(
        saveStrandsEvent(paused, {
          runLocation: RunLocation.LOCAL_AND_REMOTE,
        }),
      ).toBe(true);
    });

    it("allows activating one that can run without servers", () => {
      expect(
        saveStrandsEvent(
          { ...paused, runLocation: RunLocation.LOCAL_AND_REMOTE },
          { status: EventStatus.ACTIVE },
        ),
      ).toBe(false);
      expect(
        saveStrandsEvent(
          { ...paused, type: EventType.TOOL_ACTION },
          { status: EventStatus.ACTIVE },
        ),
      ).toBe(false);
    });
  });

  it("treats a current row with no servers list as having none", () => {
    expect(
      saveStrandsEvent(
        {
          type: EventType.BASH,
          runLocation: RunLocation.REMOTE,
          status: EventStatus.PAUSED,
        },
        { status: EventStatus.ACTIVE },
      ),
    ).toBe(true);
  });
});
