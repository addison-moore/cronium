/**
 * Env var values are encrypted at rest and record-bound to (eventId, key), and
 * `storage.getEventWithRelations` deliberately returns the ciphertext so dispatch
 * can persist it in jobs.payload. The API read path has to decrypt it for the
 * owner: it used to pass the stored value straight through, so the edit form
 * displayed `crn.1...`, and any save encrypted that ciphertext again, leaving the
 * script with an envelope instead of its secret.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { envVars, users } from "@/shared/schema";
import {
  decryptEnvVarValue,
  encryptEnvVarValue,
} from "@/lib/security/field-secret";
import {
  toEventApiDto,
  toEventForkSecurityProjection,
} from "@/server/security/api-dto";
import { resetDatabase, closePool } from "./helpers/db-reset";

const OWNER = "env-roundtrip-owner";
const SECRET = "s3cret-value";

async function seedEvent() {
  await db.insert(users).values({
    id: OWNER,
    email: "owner@example.test",
    username: "owner",
    role: "USER",
    status: "ACTIVE",
  } as never);
  return storage.createScript({
    userId: OWNER,
    name: "env roundtrip",
    type: "BASH",
    status: "DRAFT",
    content: "echo hi",
    scheduleNumber: 1,
    scheduleUnit: "MINUTES",
    timeoutValue: 30,
    timeoutUnit: "SECONDS",
    retries: 0,
  } as never);
}

/** What events.update does with whatever the form submits. */
async function saveEnvVars(
  eventId: number,
  submitted: Array<{ key: string; value: string }>,
) {
  await storage.deleteEnvVarsByEventId(eventId);
  for (const envVar of submitted) {
    await storage.createEnvVar({ eventId, ...envVar });
  }
}

async function deliveredValue(eventId: number, key: string) {
  const [row] = await db
    .select()
    .from(envVars)
    .where(eq(envVars.eventId, eventId));
  return decryptEnvVarValue(row!.value, eventId, key);
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe("env var read/save round trip", () => {
  it("shows the owner plaintext, and saving it back keeps the secret intact", async () => {
    const event = await seedEvent();
    await storage.createEnvVar({
      eventId: event.id,
      key: "API_KEY",
      value: SECRET,
    });

    const read = await storage.getEventWithRelations(event.id);
    const dto = toEventApiDto(read!, OWNER, { revealEnvVarValues: true });
    expect(dto.envVars[0]!.value).toBe(SECRET);

    await saveEnvVars(
      event.id,
      dto.envVars.map(({ key, value }) => ({ key, value })),
    );

    expect(await deliveredValue(event.id, "API_KEY")).toBe(SECRET);
    // Still ciphertext at rest: the fix must not have stored plaintext.
    const [row] = await db
      .select()
      .from(envVars)
      .where(eq(envVars.eventId, event.id));
    expect(row!.value).not.toContain(SECRET);
    expect(row!.value.startsWith("crn.1.")).toBe(true);
  });

  it("does not wrap again when a stale client resubmits ciphertext", async () => {
    const event = await seedEvent();
    const ciphertext = encryptEnvVarValue(SECRET, event.id, "API_KEY");

    await saveEnvVars(event.id, [{ key: "API_KEY", value: ciphertext }]);

    const [row] = await db
      .select()
      .from(envVars)
      .where(eq(envVars.eventId, event.id));
    expect(row!.value).toBe(ciphertext);
    expect(await deliveredValue(event.id, "API_KEY")).toBe(SECRET);
  });

  it("heals rows already wrapped several times by the old form", async () => {
    const event = await seedEvent();
    let wrapped = SECRET;
    for (let saves = 0; saves < 3; saves++) {
      wrapped = encryptEnvVarValue(wrapped, event.id, "API_KEY");
    }
    await db.insert(envVars).values({
      eventId: event.id,
      key: "API_KEY",
      value: wrapped,
    });

    expect(await deliveredValue(event.id, "API_KEY")).toBe(SECRET);
    const read = await storage.getEventWithRelations(event.id);
    const dto = toEventApiDto(read!, OWNER, { revealEnvVarValues: true });
    expect(dto.envVars[0]!.value).toBe(SECRET);
  });

  it("keeps a real value that merely looks like an envelope", async () => {
    const event = await seedEvent();
    const lookalike = "crn.1.notreal.a.b.c";
    await storage.createEnvVar({
      eventId: event.id,
      key: "API_KEY",
      value: lookalike,
    });
    expect(await deliveredValue(event.id, "API_KEY")).toBe(lookalike);
  });

  it("hides values from callers that were not granted them, keeping the keys", async () => {
    const event = await seedEvent();
    await storage.createEnvVar({
      eventId: event.id,
      key: "API_KEY",
      value: SECRET,
    });
    const read = await storage.getEventWithRelations(event.id);

    const dto = toEventApiDto(read!, OWNER);
    expect(dto.envVars[0]).toMatchObject({ key: "API_KEY", value: "" });
    expect(JSON.stringify(dto)).not.toContain("crn.1.");
    expect(JSON.stringify(dto)).not.toContain(SECRET);
  });

  it("re-encrypts under the fork's own binding when an owner forks", async () => {
    const source = await seedEvent();
    await storage.createEnvVar({
      eventId: source.id,
      key: "API_KEY",
      value: SECRET,
    });
    const read = await storage.getEventWithRelations(source.id);
    const { envVars: projected } = toEventForkSecurityProjection(read!, OWNER);
    expect(projected[0]!.value).toBe(SECRET);

    const fork = await storage.createScript({
      userId: OWNER,
      name: "fork",
      type: "BASH",
      status: "DRAFT",
      content: "echo hi",
      scheduleNumber: 1,
      scheduleUnit: "MINUTES",
      timeoutValue: 30,
      timeoutUnit: "SECONDS",
      retries: 0,
    } as never);
    await saveEnvVars(fork.id, [
      { key: "API_KEY", value: projected[0]!.value },
    ]);

    expect(await deliveredValue(fork.id, "API_KEY")).toBe(SECRET);
  });
});
