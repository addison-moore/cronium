jest.mock("@/server/db", () => ({ db: {} }));

import {
  allRequestedResourcesHaveCapability,
  eventServerRelationshipIds,
  hasResourceCapability,
} from "@/server/security/resource-access";
import {
  toEventApiDto,
  toEventForkSecurityProjection,
  toServerApiDto,
  toWorkflowApiDto,
} from "@/server/security/api-dto";
import { legacyEventPatchSchema } from "@/shared/schemas/events";
import type { Server } from "@/shared/schema";
import type {
  EventWithRelations,
  WorkflowWithRelations,
} from "@/server/storage";

const VICTIM = "user-victim";
const ATTACKER = "user-attacker";

function server(overrides: Partial<Server> = {}): Server {
  return {
    id: 41,
    userId: VICTIM,
    name: "victim-production",
    address: "10.0.0.10",
    sshKey: "PRIVATE-KEY-MATERIAL",
    password: "server-password",
    username: "deploy",
    port: 22,
    shared: true,
    online: true,
    lastChecked: null,
    isArchived: false,
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    deletionScheduledAt: null,
    sshKeyPurged: false,
    passwordPurged: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function sharedVictimEvent(): EventWithRelations {
  return {
    id: 7,
    userId: VICTIM,
    shared: true,
    name: "shared-template",
    serverId: 41,
    server: server(),
    servers: [server()],
    envVars: [
      {
        id: 1,
        eventId: 7,
        key: "TOKEN",
        value: "secret-token",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
    httpUrl: "https://example.test/hook?api_key=secret",
    httpHeaders: [{ key: "Authorization", value: "Bearer secret" }],
    httpBody: '{"token":"secret"}',
    toolActionConfig: { toolId: 99, parameters: { token: "secret" } },
  } as unknown as EventWithRelations;
}

describe("two-user resource capabilities", () => {
  const sharedVictimResource = { id: 7, userId: VICTIM, shared: true };

  it("limits a shared event to view/fork and denies attacker execution", () => {
    expect(hasResourceCapability(sharedVictimResource, ATTACKER, "view")).toBe(
      true,
    );
    expect(hasResourceCapability(sharedVictimResource, ATTACKER, "fork")).toBe(
      true,
    );
    expect(hasResourceCapability(sharedVictimResource, ATTACKER, "edit")).toBe(
      false,
    );
    expect(
      hasResourceCapability(sharedVictimResource, ATTACKER, "execute"),
    ).toBe(false);
    expect(
      hasResourceCapability(sharedVictimResource, ATTACKER, "use-secret"),
    ).toBe(false);
  });

  it("rejects mixed-owner and missing relationship IDs", () => {
    const victimServer = { id: 41, userId: VICTIM, shared: true };
    const attackerServer = { id: 42, userId: ATTACKER, shared: false };

    expect(
      allRequestedResourcesHaveCapability(
        [41, 42],
        [victimServer, attackerServer],
        ATTACKER,
        "use-secret",
      ),
    ).toBe(false);
    expect(
      allRequestedResourcesHaveCapability(
        [41, 999],
        [victimServer],
        VICTIM,
        "use-secret",
      ),
    ).toBe(false);
    expect(
      allRequestedResourcesHaveCapability(
        [42, 42],
        [attackerServer],
        ATTACKER,
        "use-secret",
      ),
    ).toBe(true);
  });

  it("authorizes both singular and selected event server relation fields", () => {
    expect(eventServerRelationshipIds(41, [42, 41])).toEqual([42, 41]);

    const victimServer = { id: 41, userId: VICTIM, shared: true };
    const attackerServer = { id: 42, userId: ATTACKER, shared: false };
    expect(
      allRequestedResourcesHaveCapability(
        eventServerRelationshipIds(41, [42]),
        [victimServer, attackerServer],
        ATTACKER,
        "use-secret",
      ),
    ).toBe(false);
  });

  it("denies a victim event used as an attacker workflow node", () => {
    expect(
      allRequestedResourcesHaveCapability(
        [7],
        [sharedVictimResource],
        ATTACKER,
        "execute",
      ),
    ).toBe(false);
  });
});

describe("secret-free API DTOs", () => {
  it("never returns a server password or private key, even to its owner", () => {
    const dto = toServerApiDto(server());

    expect(dto).not.toHaveProperty("sshKey");
    expect(dto).not.toHaveProperty("password");
    expect(dto.hasPrivateKey).toBe(true);
    expect(dto.hasPassword).toBe(true);
  });

  it("drops raw Drizzle event-server relations for owners and shared viewers", () => {
    const event = {
      ...sharedVictimEvent(),
      eventServers: [
        {
          eventId: 7,
          serverId: 41,
          server: server({
            sshKey: "NESTED-PRIVATE-KEY-SENTINEL",
            password: "NESTED-PASSWORD-SENTINEL",
          }),
        },
      ],
    } as EventWithRelations & { eventServers: unknown[] };

    for (const viewer of [VICTIM, ATTACKER]) {
      const dto = toEventApiDto(event, viewer);
      const serialized = JSON.stringify(dto);
      expect(dto).not.toHaveProperty("eventServers");
      expect(serialized).not.toContain("NESTED-PRIVATE-KEY-SENTINEL");
      expect(serialized).not.toContain("NESTED-PASSWORD-SENTINEL");
      expect(serialized).not.toContain('"sshKey"');
      expect(serialized).not.toContain('"password"');
    }
  });

  it("sanitizes a victim's shared event for an attacker", () => {
    const dto = toEventApiDto(sharedVictimEvent(), ATTACKER);

    expect(dto.secretFieldsRedacted).toBe(true);
    expect(dto.envVars).toEqual([]);
    expect(dto.serverId).toBeNull();
    expect(dto.server).toBeNull();
    expect(dto.servers).toEqual([]);
    expect(dto.httpUrl).toBeNull();
    expect(dto.httpHeaders).toEqual([]);
    expect(dto.httpBody).toBeNull();
    expect(dto.toolActionConfig).toBeNull();
  });

  it("does not copy a shared owner's secret-bearing URL or bindings on fork", () => {
    const projection = toEventForkSecurityProjection(
      sharedVictimEvent(),
      ATTACKER,
    );

    expect(projection.owner).toBe(false);
    expect(projection.httpUrl).toBeNull();
    expect(projection.httpHeaders).toEqual([]);
    expect(projection.httpBody).toBeNull();
    expect(projection.runLocation).toBe("LOCAL");
    expect(projection.serverId).toBeNull();
    expect(projection.envVars).toEqual([]);
    expect(projection.servers).toEqual([]);
  });

  it("sanitizes nested events and workflow override targets", () => {
    const workflow = {
      id: 3,
      userId: VICTIM,
      shared: true,
      overrideServerIds: [41],
      nodes: [
        {
          id: 10,
          workflowId: 3,
          eventId: 7,
          event: sharedVictimEvent(),
        },
      ],
      connections: [],
    } as unknown as WorkflowWithRelations;

    const dto = toWorkflowApiDto(workflow, ATTACKER);
    expect(dto.overrideServerIds).toEqual([]);
    expect(dto.nodes[0]?.event?.secretFieldsRedacted).toBe(true);
    expect(dto.nodes[0]?.event?.servers).toEqual([]);
  });
});

describe("legacy event PATCH allowlist", () => {
  it.each(["userId", "source", "executionCount", "createdAt"])(
    "rejects protected field %s",
    (field) => {
      const result = legacyEventPatchSchema.safeParse({
        name: "attacker update",
        [field]: field === "executionCount" ? 999 : "victim-value",
      });
      expect(result.success).toBe(false);
    },
  );

  it("accepts intended mutable fields", () => {
    expect(
      legacyEventPatchSchema.safeParse({
        name: "safe update",
        selectedServerIds: [42],
      }).success,
    ).toBe(true);
  });
});
