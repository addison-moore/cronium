/**
 * Blocking adversarial checks for cross-tenant access and socket identity.
 * These tests are hermetic: CI does not need a live API, database, or Valkey.
 */
jest.mock("@/server/db", () => ({ db: {} }));
jest.mock("@/server/storage", () => ({ storage: { getUser: jest.fn() } }));

import {
  authenticateSocketTicket,
  mintSocketTicket,
} from "@/lib/socket-ticket";
import {
  allRequestedResourcesHaveCapability,
  hasResourceCapability,
} from "@/server/security/resource-access";
import {
  isAllowedSocketOrigin,
  verifyInternalBroadcastAuthorization,
} from "@/server/socket-security";
import { UserRole, UserStatus } from "@/shared/schema";
import { securityFixtures } from "./fixtures";

const OWNER = securityFixtures.users.owner.id;
const ATTACKER = securityFixtures.users.attacker.id;

describe("tenant authorization boundaries", () => {
  const sharedVictimEvent = securityFixtures.resources.sharedEvent;

  it("does not turn sharing into edit, execute, or secret access", () => {
    expect(hasResourceCapability(sharedVictimEvent, ATTACKER, "view")).toBe(
      true,
    );
    expect(hasResourceCapability(sharedVictimEvent, ATTACKER, "fork")).toBe(
      true,
    );
    expect(hasResourceCapability(sharedVictimEvent, ATTACKER, "edit")).toBe(
      false,
    );
    expect(hasResourceCapability(sharedVictimEvent, ATTACKER, "execute")).toBe(
      false,
    );
    expect(
      hasResourceCapability(sharedVictimEvent, ATTACKER, "use-secret"),
    ).toBe(false);
  });

  it("rejects mixed-owner and unresolved relationship IDs", () => {
    const resources = [
      securityFixtures.resources.sharedServer,
      securityFixtures.resources.attackerServer,
    ];

    expect(
      allRequestedResourcesHaveCapability(
        resources.map(({ id }) => id),
        resources,
        ATTACKER,
        "use-secret",
      ),
    ).toBe(false);
    expect(
      allRequestedResourcesHaveCapability(
        [securityFixtures.resources.attackerServer.id, 999],
        resources,
        ATTACKER,
        "use-secret",
      ),
    ).toBe(false);
  });

  it("keeps queued and running jobs bound to their originating tenant", () => {
    expect(securityFixtures.jobs.queued.userId).toBe(OWNER);
    expect(securityFixtures.jobs.queued.eventId).toBe(
      securityFixtures.resources.ownedEvent.id,
    );
    expect(securityFixtures.jobs.running.userId).toBe(ATTACKER);
    expect(securityFixtures.jobs.running.eventId).toBe(
      securityFixtures.resources.attackerEvent.id,
    );
  });
});

describe("socket authentication boundaries", () => {
  const activeUser = async () => ({
    id: OWNER,
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  it("consumes a ticket once across independent authenticators", async () => {
    const consumed = new Set<string>();
    const sharedConsumer = async (jti: string) => {
      if (consumed.has(jti)) return false;
      consumed.add(jti);
      return true;
    };
    const { ticket } = mintSocketTicket(OWNER, "logs");

    await expect(
      authenticateSocketTicket(ticket, "logs", {
        consumeTicket: sharedConsumer,
        getUser: activeUser,
      }),
    ).resolves.toMatchObject({ userId: OWNER, role: UserRole.USER });
    await expect(
      authenticateSocketTicket(ticket, "logs", {
        consumeTicket: sharedConsumer,
        getUser: activeUser,
      }),
    ).resolves.toBeNull();
  });

  it("fails closed when the shared replay store is unavailable", async () => {
    const { ticket } = mintSocketTicket(OWNER, "terminal");

    await expect(
      authenticateSocketTicket(ticket, "terminal", {
        consumeTicket: async () => {
          throw new Error("Valkey unavailable");
        },
        getUser: activeUser,
      }),
    ).resolves.toBeNull();
  });

  it("rejects a principal disabled after ticket issuance", async () => {
    const { ticket } = mintSocketTicket(OWNER, "terminal");

    await expect(
      authenticateSocketTicket(ticket, "terminal", {
        consumeTicket: async () => true,
        getUser: async () => securityFixtures.users.disabled,
      }),
    ).resolves.toBeNull();
  });

  it("provides explicit viewer, admin, and demoted principals", () => {
    expect(securityFixtures.roles.viewer.permissions.console).toBe(false);
    expect(securityFixtures.users.viewer.roleId).toBe(
      securityFixtures.roles.viewer.id,
    );
    expect(securityFixtures.users.admin.role).toBe(UserRole.ADMIN);
    expect(securityFixtures.users.demoted.previousRole).toBe(UserRole.ADMIN);
    expect(securityFixtures.users.demoted.role).toBe(UserRole.USER);
  });
});

describe("socket network boundaries", () => {
  it("requires exact origins and exact internal bearer authorization", () => {
    const origin = "https://cronium.example";
    const key = "internal-broadcast-secret";

    expect(isAllowedSocketOrigin(origin, [origin])).toBe(true);
    expect(isAllowedSocketOrigin(`${origin}.evil.test`, [origin])).toBe(false);
    expect(verifyInternalBroadcastAuthorization(`Bearer ${key}`, key)).toBe(
      true,
    );
    expect(verifyInternalBroadcastAuthorization(`Basic ${key}`, key)).toBe(
      false,
    );
  });
});
