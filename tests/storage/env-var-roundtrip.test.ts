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
import { envVars, jobs, users } from "@/shared/schema";
import { MAX_ENV_VAR_VALUE_BYTES } from "@/shared/schemas/events";
import {
  decryptEnvVarValue,
  encryptEnvVarValue,
} from "@/lib/security/field-secret";
import { dispatchEventJob } from "@/lib/scheduling/dispatch";
import { jobService } from "@/lib/services/job-service";
import { prepareJobsForOrchestrator } from "@/lib/services/enhanced-job-transformer";
import {
  toEventApiDto,
  toEventForkSecurityProjection,
} from "@/server/security/api-dto";
import { resetDatabase, closePool } from "./helpers/db-reset";
import { seedServer } from "./helpers/seed";

// A project's testTimeout has no effect, and the default 5 seconds is too little for
// resetDatabase on a busy machine.
jest.setTimeout(30_000);

const OWNER = "env-roundtrip-owner";
const SECRET = "s3cret-value";

async function seedOwner() {
  await db.insert(users).values({
    id: OWNER,
    email: "owner@example.test",
    username: "owner",
    role: "USER",
    status: "ACTIVE",
  } as never);
}

function createEvent(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  } as never);
}

async function seedEvent() {
  await seedOwner();
  return createEvent();
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

// The value is stored as an envelope of 55 characters plus 4/3 of its length. varchar(255)
// ran out past 150 characters, so ordinary JWTs and API keys couldn't be saved.
describe("a value too long for the old varchar(255) column", () => {
  const PEM = [
    "-----BEGIN PRIVATE KEY-----",
    ...Array.from({ length: 40 }, () =>
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC".repeat(2),
    ),
    "-----END PRIVATE KEY-----",
    "",
  ].join("\n");

  it.each([
    ["one character past the old limit", "x".repeat(151)],
    ["a JWT", `eyJhbGciOiJSUzI1NiJ9.${"eyJzdWIiOiIxIn0".repeat(300)}.c2ln`],
    ["a PEM key, line breaks and all", PEM],
    ["the most the API accepts", "x".repeat(MAX_ENV_VAR_VALUE_BYTES)],
    [
      "the most the API accepts in two-byte characters",
      "é".repeat(MAX_ENV_VAR_VALUE_BYTES / 2),
    ],
  ])("saves, reads back and saves again: %s", async (_label, value) => {
    const event = await seedEvent();
    await storage.createEnvVar({ eventId: event.id, key: "API_KEY", value });

    const read = await storage.getEventWithRelations(event.id);
    const dto = toEventApiDto(read!, OWNER, { revealEnvVarValues: true });
    expect(dto.envVars[0]!.value).toBe(value);

    await saveEnvVars(
      event.id,
      dto.envVars.map(({ key, value }) => ({ key, value })),
    );

    expect(await deliveredValue(event.id, "API_KEY")).toBe(value);
    const [row] = await db
      .select()
      .from(envVars)
      .where(eq(envVars.eventId, event.id));
    expect(row!.value.startsWith("crn.1.")).toBe(true);
    expect(row!.value).not.toContain(value);
  });

  /** Dispatches the event as a run does, and claims and prepares its job. */
  async function runToDelivery(eventId: number) {
    const event = await storage.getEventWithRelations(eventId);
    const { job } = await dispatchEventJob(event!, { triggeredBy: "manual" });
    const claimed = await jobService.claimJobs("orchestrator-1", 1);
    expect(claimed.map(({ id }) => id)).toEqual([job!.id]);

    const { ready, failed } = await prepareJobsForOrchestrator(claimed);
    expect(failed).toEqual([]);
    return {
      jobId: job!.id,
      type: ready[0]!.transformed.type,
      environment: ready[0]!.transformed.execution.environment,
    };
  }

  const LONG = "x".repeat(MAX_ENV_VAR_VALUE_BYTES);

  it("stays encrypted in jobs.payload and reaches a container job whole", async () => {
    const event = await seedEvent();
    await storage.createEnvVar({
      eventId: event.id,
      key: "API_KEY",
      value: LONG,
    });

    const { jobId, type, environment } = await runToDelivery(event.id);

    expect(type).toBe("container");
    expect(environment.API_KEY).toBe(LONG);
    const [persisted] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    const stored = persisted!.payload as { environment: { API_KEY: string } };
    expect(stored.environment.API_KEY.startsWith("crn.1.")).toBe(true);
    expect(JSON.stringify(persisted!.payload)).not.toContain(LONG);
  });

  // At the limit a job row holds about 1.33 MB of this, and the Jobs page lists 50.
  it("stays out of a list of jobs, and nothing else does", async () => {
    const event = await seedEvent();
    await storage.createEnvVar({
      eventId: event.id,
      key: "API_KEY",
      value: LONG,
    });
    const read = await storage.getEventWithRelations(event.id);
    const { job } = await dispatchEventJob(read!, { triggeredBy: "manual" });

    const full = (await jobService.getJob(job!.id))!;
    const { environment, ...rest } = full.payload as {
      environment: { API_KEY: string };
    };
    expect(environment.API_KEY.startsWith("crn.1.")).toBe(true);

    const { jobs: listed, total } = await jobService.listJobs({
      userId: OWNER,
    });

    expect(total).toBe(1);
    expect(listed[0]).toEqual({ ...full, payload: rest });
    expect(JSON.stringify(listed)).not.toContain("crn.1.");
  });

  it("reaches a job for a remote server whole", async () => {
    await seedOwner();
    const serverId = await seedServer(OWNER);
    const event = await createEvent({ runLocation: "REMOTE", serverId });
    await storage.createEnvVar({
      eventId: event.id,
      key: "API_KEY",
      value: LONG,
    });

    const { type, environment } = await runToDelivery(event.id);

    expect(type).toBe("ssh");
    expect(environment.API_KEY).toBe(LONG);
  });
});
