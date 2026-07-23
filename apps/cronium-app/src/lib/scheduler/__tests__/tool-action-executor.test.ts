/**
 * @jest-environment node
 */
// Factory-mock every dependency that pulls in @/server/db, @/server/storage,
// or @/env.mjs (ESM t3-env crashes jest). Placed physically before all imports.
jest.mock("@/server/db", () => ({ db: { insert: jest.fn() } }));
jest.mock("@/server/storage", () => ({
  storage: { getUserVariables: jest.fn() },
}));
jest.mock("@/lib/tools/credential-cache", () => ({
  credentialCache: { get: jest.fn() },
}));
jest.mock("@/lib/security/rate-limiter", () => ({
  rateLimiter: { checkRateLimit: jest.fn(), checkQuota: jest.fn() },
}));
jest.mock("@/lib/security/audit-logger", () => ({
  auditLog: {
    rateLimitExceeded: jest.fn(),
    toolExecuted: jest.fn(),
    toolExecutionFailed: jest.fn(),
  },
}));
jest.mock("@/lib/security/credential-encryption", () => ({
  credentialEncryption: { isAvailable: jest.fn(), decrypt: jest.fn() },
}));
jest.mock("@/lib/oauth/credential-bridge", () => ({
  injectOAuthToken: jest.fn(),
}));
jest.mock("@/lib/tools/server-action-executor", () => ({
  getServerActionById: jest.fn(),
  getAllServerActionIds: jest.fn(() => []),
}));
jest.mock("@/lib/tools/circuit-breaker", () => ({
  circuitBreakerManager: {
    getBreaker: jest.fn(() => ({
      execute: (fn: () => Promise<unknown>) => fn(),
    })),
  },
}));
jest.mock("../tool-action-health-monitor", () => ({
  toolActionHealthMonitor: { recordExecution: jest.fn() },
}));
jest.mock("@/lib/featureFlags", () => ({
  isToolActionsExecutionEnabled: jest.fn(() => true),
}));

import { executeToolAction } from "../tool-action-executor";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { credentialCache } from "@/lib/tools/credential-cache";
import { rateLimiter } from "@/lib/security/rate-limiter";
import { auditLog } from "@/lib/security/audit-logger";
import { credentialEncryption } from "@/lib/security/credential-encryption";
import { injectOAuthToken } from "@/lib/oauth/credential-bridge";
import { getServerActionById } from "@/lib/tools/server-action-executor";
import { toolActionHealthMonitor } from "../tool-action-health-monitor";
import { isToolActionsExecutionEnabled } from "@/lib/featureFlags";
import type { Event } from "@/shared/schema";

const mockInsert = db.insert as jest.Mock;
const mockGetUserVariables = storage.getUserVariables as jest.Mock;
const mockCacheGet = credentialCache.get as jest.Mock;
const mockCheckRateLimit = rateLimiter.checkRateLimit as jest.Mock;
const mockCheckQuota = rateLimiter.checkQuota as jest.Mock;
const mockIsAvailable = credentialEncryption.isAvailable as jest.Mock;
const mockDecrypt = credentialEncryption.decrypt as jest.Mock;
const mockInjectOAuth = injectOAuthToken as jest.Mock;
const mockGetAction = getServerActionById as jest.Mock;
const mockRecordExecution =
  toolActionHealthMonitor.recordExecution as jest.Mock;
const mockFlag = isToolActionsExecutionEnabled as jest.Mock;

const SECRET_TOKEN = "xoxb-super-secret-abcdefgh12345678";

interface FakeAction {
  id: string;
  name: string;
  actionType: string;
  producesOutput?: boolean;
  features?: { webhookSupport?: boolean };
  inputSchema: { parse: jest.Mock };
  execute: jest.Mock;
}

function makeAction(overrides: Partial<FakeAction> = {}): FakeAction {
  return {
    id: "slack-send-message",
    name: "Send Slack Message",
    actionType: "send",
    producesOutput: false,
    features: {},
    inputSchema: { parse: jest.fn() },
    execute: jest.fn().mockResolvedValue({ success: true, ts: "111.222" }),
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}): Event {
  return {
    id: 42,
    name: "Notify",
    userId: "user-1",
    type: "TOOL_ACTION",
    serverId: null,
    timeoutValue: 30,
    timeoutUnit: "SECONDS",
    toolActionConfig: {
      toolType: "slack",
      actionId: "slack-send-message",
      toolId: 7,
      parameters: { channel: "#general", text: "hi" },
    },
    ...overrides,
  } as unknown as Event;
}

const baseTool = {
  id: 7,
  name: "Team Slack",
  type: "slack",
  isActive: true,
  encrypted: false,
  credentials: { token: SECRET_TOKEN },
};

let mockValues: jest.Mock;
let action: FakeAction;

beforeEach(() => {
  jest.clearAllMocks();
  // Keep the executor's very chatty console output out of the test log.
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "debug").mockImplementation(() => undefined);

  // clearAllMocks does not drop per-test mockImplementations; reset the ones
  // that individual tests override with throwing implementations.
  mockDecrypt.mockReset();
  mockIsAvailable.mockReset();
  mockFlag.mockReturnValue(true);
  mockValues = jest.fn().mockResolvedValue(undefined);
  mockInsert.mockReturnValue({ values: mockValues });
  mockGetUserVariables.mockResolvedValue([]);
  mockCacheGet.mockResolvedValue({ ...baseTool });
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    limit: 60,
    remaining: 59,
    resetAt: new Date(),
  });
  mockCheckQuota.mockResolvedValue({
    allowed: true,
    hourly: { used: 1, limit: 100 },
    daily: { used: 1, limit: 1000 },
  });
  mockInjectOAuth.mockImplementation((creds: Record<string, unknown>) =>
    Promise.resolve(creds),
  );
  action = makeAction();
  mockGetAction.mockReturnValue(action);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("executeToolAction — guards", () => {
  it("throws (rejects) when tool action execution is feature-flag disabled", async () => {
    mockFlag.mockReturnValue(false);

    await expect(executeToolAction(makeEvent())).rejects.toThrow(
      "Tool action execution is disabled via feature flags",
    );
    expect(mockCacheGet).not.toHaveBeenCalled();
  });

  it("fails with exit 1 when the config is incomplete", async () => {
    const result = await executeToolAction(
      makeEvent({ toolActionConfig: { toolType: "slack" } }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Incomplete tool action configuration");
    expect(result.healthStatus?.status).toBe("failing");
    expect(auditLog.toolExecutionFailed).toHaveBeenCalledWith(
      { userId: "user-1", toolId: 0 },
      "unknown",
      "Incomplete tool action configuration",
    );
  });

  it("fails when the stored config is unparseable (parses to null)", async () => {
    const result = await executeToolAction(
      makeEvent({ toolActionConfig: "not-json" }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Incomplete tool action configuration");
    // The failure is still persisted to tool_action_logs with unknown ids.
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILURE",
        actionId: "unknown",
        toolType: "unknown",
      }),
    );
  });

  it("fails when the tool is not found in the credential cache", async () => {
    mockCacheGet.mockResolvedValue(null);

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Tool not found: 7");
  });

  it("fails when the tool is inactive", async () => {
    mockCacheGet.mockResolvedValue({ ...baseTool, isActive: false });

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Tool is not active: Team Slack");
    expect(action.execute).not.toHaveBeenCalled();
  });
});

describe("executeToolAction — rate limits and quotas", () => {
  it("rejects when the rate limit is exceeded and audits it", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: new Date(),
      retryAfter: 30,
    });

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Rate limit exceeded. Try again in 30 seconds",
    );
    expect(auditLog.rateLimitExceeded).toHaveBeenCalledWith(
      { userId: "user-1", toolId: 7 },
      60,
      "1 minute",
    );
    expect(action.execute).not.toHaveBeenCalled();
  });

  it("falls back to 60 seconds when retryAfter is missing", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, limit: 60 });

    const result = await executeToolAction(makeEvent());

    expect(result.stderr).toContain("Try again in 60 seconds");
  });

  it("rejects when the hourly quota is exhausted", async () => {
    mockCheckQuota.mockResolvedValue({
      allowed: false,
      hourly: { used: 100, limit: 100 },
      daily: { used: 100, limit: 1000 },
    });

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("hourly quota exceeded. Used 100/100");
  });

  it("rejects when the daily quota is exhausted", async () => {
    mockCheckQuota.mockResolvedValue({
      allowed: false,
      hourly: { used: 5, limit: 100 },
      daily: { used: 1000, limit: 1000 },
    });

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("daily quota exceeded. Used 1000/1000");
  });
});

describe("executeToolAction — credential handling", () => {
  it("decrypts string-encoded encrypted credentials and passes them to the action", async () => {
    mockCacheGet.mockResolvedValue({
      ...baseTool,
      encrypted: true,
      credentials: JSON.stringify({ ciphertext: "abc", iv: "def" }),
    });
    mockIsAvailable.mockReturnValue(true);
    mockDecrypt.mockReturnValue(JSON.stringify({ token: "decrypted-token" }));

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(0);
    expect(mockDecrypt).toHaveBeenCalledWith({ ciphertext: "abc", iv: "def" });
    expect(action.execute).toHaveBeenCalledWith(
      { token: "decrypted-token" },
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("accepts object-form encrypted credentials and an object decrypt result", async () => {
    const blob = { ciphertext: "xyz", iv: "123" };
    mockCacheGet.mockResolvedValue({
      ...baseTool,
      encrypted: true,
      credentials: blob,
    });
    mockIsAvailable.mockReturnValue(true);
    mockDecrypt.mockReturnValue({ apiKey: "plain-object" });

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(0);
    expect(mockDecrypt).toHaveBeenCalledWith(blob);
    expect(action.execute).toHaveBeenCalledWith(
      { apiKey: "plain-object" },
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("fails when credentials are encrypted but no encryption key is configured", async () => {
    mockCacheGet.mockResolvedValue({
      ...baseTool,
      encrypted: true,
      credentials: "{}",
    });
    mockIsAvailable.mockReturnValue(false);

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Encryption key not configured");
    expect(action.execute).not.toHaveBeenCalled();
  });

  it("fails when decryption throws", async () => {
    mockCacheGet.mockResolvedValue({
      ...baseTool,
      encrypted: true,
      credentials: JSON.stringify({ ciphertext: "abc" }),
    });
    mockIsAvailable.mockReturnValue(true);
    mockDecrypt.mockImplementation(() => {
      throw new Error("bad auth tag");
    });

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Failed to decrypt tool credentials: bad auth tag",
    );
  });

  it("parses unencrypted string credentials", async () => {
    mockCacheGet.mockResolvedValue({
      ...baseTool,
      credentials: JSON.stringify({ token: "plain" }),
    });

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(0);
    expect(action.execute).toHaveBeenCalledWith(
      { token: "plain" },
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("fails on malformed unencrypted string credentials", async () => {
    mockCacheGet.mockResolvedValue({ ...baseTool, credentials: "{oops" });

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid credential format");
  });

  it("injects OAuth credentials via the credential bridge before executing", async () => {
    mockInjectOAuth.mockResolvedValue({
      token: SECRET_TOKEN,
      oauthToken: "fresh-access-token",
    });

    await executeToolAction(makeEvent());

    expect(mockInjectOAuth).toHaveBeenCalledWith(
      { token: SECRET_TOKEN },
      { userId: "user-1", toolId: 7, toolType: "slack" },
    );
    expect(action.execute).toHaveBeenCalledWith(
      { token: SECRET_TOKEN, oauthToken: "fresh-access-token" },
      expect.any(Object),
      expect.any(Object),
    );
  });
});

describe("executeToolAction — action resolution and validation", () => {
  it("fails when the action id is not in the server registry", async () => {
    mockGetAction.mockReturnValue(undefined);

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Action not found: slack-send-message");
  });

  it("surfaces zod-style validation errors with field paths", async () => {
    const zodish = new Error("validation");
    (zodish as unknown as { errors: unknown }).errors = [
      { path: ["channel"], message: "Required" },
      { path: ["text"], message: "Too short" },
    ];
    action.inputSchema.parse.mockImplementation(() => {
      throw zodish;
    });

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Parameter validation failed: channel: Required, text: Too short",
    );
    expect(action.execute).not.toHaveBeenCalled();
  });

  it("surfaces plain validation errors", async () => {
    action.inputSchema.parse.mockImplementation(() => {
      throw new Error("nope");
    });

    const result = await executeToolAction(makeEvent());

    expect(result.stderr).toContain("Parameter validation failed: nope");
  });
});

describe("executeToolAction — happy path", () => {
  it("executes the action and returns a success result with health status", async () => {
    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.data).toEqual({ success: true, ts: "111.222" });
    expect(result.producesOutput).toBe(false);
    expect(result.healthStatus).toMatchObject({
      toolId: 7,
      actionId: "slack-send-message",
      status: "healthy",
    });

    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(output.actionId).toBe("slack-send-message");
    expect(output.actionName).toBe("Send Slack Message");
    expect(output.result).toEqual({ success: true, ts: "111.222" });

    expect(mockRecordExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: "healthy" }),
    );
    expect(auditLog.toolExecuted).toHaveBeenCalledWith(
      { userId: "user-1", toolId: 7 },
      "slack-send-message",
      expect.any(Number),
    );
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 42,
        toolType: "slack",
        actionType: "send",
        actionId: "slack-send-message",
        status: "SUCCESS",
        errorMessage: null,
      }),
    );
  });

  it("validates and passes merged parameters where input overrides config", async () => {
    await executeToolAction(makeEvent(), { text: "from-workflow" });

    const merged = action.inputSchema.parse.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(merged).toMatchObject({
      channel: "#general",
      text: "from-workflow",
    });
    expect(action.execute).toHaveBeenCalledWith(
      { token: SECRET_TOKEN },
      expect.objectContaining({ text: "from-workflow" }),
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
  });

  it("resolves template placeholders in parameters from user variables", async () => {
    mockGetUserVariables.mockResolvedValue([
      { key: "greeting", value: "hello world" },
    ]);
    const event = makeEvent({
      toolActionConfig: {
        toolType: "slack",
        actionId: "slack-send-message",
        toolId: 7,
        parameters: {
          channel: "#general",
          text: "{{cronium.getVariables.greeting}}",
        },
      },
    });

    await executeToolAction(event);

    expect(action.execute).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ text: "hello world" }),
      expect.any(Object),
    );
  });

  it("provides a usable execution context (logger, no-op variables, partial results)", async () => {
    action.execute.mockImplementation(
      (
        _creds: unknown,
        _params: unknown,
        ctx: {
          variables: {
            get: (k: string) => unknown;
            set: (k: string, v: unknown) => void;
          };
          logger: Record<
            "info" | "warn" | "error" | "debug",
            (m: string) => void
          >;
          onPartialResult?: (r: unknown) => void;
        },
      ) => {
        ctx.logger.error("provider hiccup");
        ctx.logger.debug("payload built");
        // Documented no-ops: tool actions use runtime helpers, not this store.
        ctx.variables.set("k", "v");
        expect(ctx.variables.get("k")).toBeNull();
        ctx.onPartialResult?.({ token: SECRET_TOKEN });
        return Promise.resolve({ success: true });
      },
    );

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(0);
  });

  it("marks producesOutput true when the action declares it", async () => {
    action = makeAction({ producesOutput: true });
    mockGetAction.mockReturnValue(action);

    const result = await executeToolAction(makeEvent());

    expect(result.producesOutput).toBe(true);
  });

  it("defaults producesOutput to false when the action does not declare it", async () => {
    action = makeAction({ producesOutput: undefined });
    mockGetAction.mockReturnValue(action);

    const result = await executeToolAction(makeEvent());

    expect(result.producesOutput).toBe(false);
  });

  it("reports degraded health when execution is slow (>5s)", async () => {
    let t = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      t += 6000;
      return t;
    });

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(0);
    expect(result.healthStatus?.status).toBe("degraded");
  });

  it("still succeeds when the tool_action_logs insert fails", async () => {
    mockValues.mockRejectedValue(new Error("db down"));

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(0);
  });
});

describe("executeToolAction — secret redaction", () => {
  const secretParams = {
    channel: "#general",
    webhookUrl: "https://hooks.example.com/services/T000/B000/supersecretpath",
    token: SECRET_TOKEN,
  };

  it("redacts secret parameters from stdout and the persisted success log", async () => {
    const event = makeEvent({
      toolActionConfig: {
        toolType: "slack",
        actionId: "slack-send-message",
        toolId: 7,
        parameters: secretParams,
      },
    });

    const result = await executeToolAction(event);

    expect(result.exitCode).toBe(0);
    // The raw secrets must not appear anywhere in the returned stdout.
    expect(result.stdout).not.toContain(SECRET_TOKEN);
    expect(result.stdout).not.toContain("supersecretpath");
    const output = JSON.parse(result.stdout) as {
      parameters: Record<string, unknown>;
    };
    expect(output.parameters.token).toBe("[REDACTED]");
    expect(output.parameters.webhookUrl).toBe("[REDACTED]");
    // ...and not in the tool_action_logs row either.
    const logged = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.stringify(logged.parameters)).not.toContain(SECRET_TOKEN);
    expect(JSON.stringify(logged.result)).not.toContain(SECRET_TOKEN);
    // But the action itself received the real values.
    expect(action.execute).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ token: SECRET_TOKEN }),
      expect.any(Object),
    );
  });

  it("redacts secret parameters from the persisted failure log", async () => {
    action.execute.mockRejectedValue(new Error("provider exploded"));
    const event = makeEvent({
      toolActionConfig: {
        toolType: "slack",
        actionId: "slack-send-message",
        toolId: 7,
        parameters: secretParams,
      },
    });

    const result = await executeToolAction(event);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain(SECRET_TOKEN);
    const logged = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(logged.status).toBe("FAILURE");
    expect(JSON.stringify(logged.parameters)).not.toContain(SECRET_TOKEN);
    expect(JSON.stringify(logged.parameters)).not.toContain("supersecretpath");
  });
});

describe("executeToolAction — action failure paths", () => {
  it("converts a {success:false} action result into a failed job with the provider error", async () => {
    action.execute.mockResolvedValue({
      success: false,
      error: "channel_not_found",
    });

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("channel_not_found");
    expect(mockRecordExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failing" }),
    );
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILURE" }),
    );
    expect(auditLog.toolExecuted).not.toHaveBeenCalled();
  });

  it("uses a generic message when a failure result has no error string", async () => {
    action.execute.mockResolvedValue({ ok: false });

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Send Slack Message reported failure");
  });

  it("returns a categorized error with recovery suggestions when the action throws", async () => {
    action.execute.mockRejectedValue(new Error("ECONNREFUSED to slack"));

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ECONNREFUSED to slack");
    const data = result.data as {
      error: { category: string };
      suggestions: unknown[];
    };
    expect(typeof data.error.category).toBe("string");
    expect(Array.isArray(data.suggestions)).toBe(true);
    // The retry executor wraps the original message
    // ("Retry failed: ... Original error: <msg>"); assert on the original.
    expect(auditLog.toolExecutionFailed).toHaveBeenCalledWith(
      { userId: "user-1", toolId: 7 },
      "slack-send-message",
      expect.stringContaining("ECONNREFUSED to slack"),
    );
    expect(result.healthStatus).toMatchObject({
      toolId: 7,
      actionId: "slack-send-message",
      status: "failing",
    });
  });

  it("fails the job when the action exceeds the event timeout", async () => {
    // timeoutValue 0 -> a 0ms budget, so the never-resolving action times out
    // immediately without slowing the suite down.
    action.execute.mockReturnValue(new Promise(() => undefined));

    const result = await executeToolAction(makeEvent({ timeoutValue: 0 }));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("timed out after 0ms");
  });

  it("still returns the failure result when the failure log insert also fails", async () => {
    action.execute.mockRejectedValue(new Error("boom"));
    mockValues.mockRejectedValue(new Error("db down"));

    const result = await executeToolAction(makeEvent());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("boom");
  });
});
