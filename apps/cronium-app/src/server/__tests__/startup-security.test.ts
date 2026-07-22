/**
 * @jest-environment node
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const validationScript = path.resolve(
  __dirname,
  "../../../scripts/validate-env.cjs",
);

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AUTH_SECRET: "a".repeat(32),
    ENCRYPTION_KEY: "a".repeat(64),
    CRONIUM_ORCHESTRATOR_KEY: "a".repeat(16),
    SOCKET_BROADCAST_KEY: "a".repeat(16),
    JWT_SECRET: "a".repeat(32),
    DATABASE_URL: "postgres://cronium:password@postgres:5432/cronium",
    VALKEY_URL: "valkey://valkey:6379",
    REDIS_URL: undefined,
  };
}

function validate(environment: NodeJS.ProcessEnv, role?: string) {
  return spawnSync(
    process.execPath,
    role ? [validationScript, role] : [validationScript],
    {
      env: environment,
      encoding: "utf8",
    },
  );
}

describe("production security preflight", () => {
  it("accepts the documented Valkey URL alias", () => {
    const result = validate(validEnvironment());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Environment validation passed");
  });

  it("rejects startup without shared socket replay storage", () => {
    const environment = validEnvironment();
    delete environment.VALKEY_URL;
    delete environment.REDIS_URL;

    const result = validate(environment);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("VALKEY_URL");
    expect(result.stderr).toContain("shared socket replay protection");
  });

  it("requires the orchestrator key for the app role", () => {
    const environment = validEnvironment();
    delete environment.CRONIUM_ORCHESTRATOR_KEY;

    const result = validate(environment);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CRONIUM_ORCHESTRATOR_KEY");
  });

  it("does NOT require the orchestrator key for the worker role", () => {
    // The worker only broadcasts; it never serves the orchestrator routes, so
    // it must not need the orchestrator service-identity key (least privilege).
    const environment = validEnvironment();
    delete environment.CRONIUM_ORCHESTRATOR_KEY;

    const result = validate(environment, "worker");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Environment validation passed");
  });

  it("still requires the socket broadcast key for the worker role", () => {
    const environment = validEnvironment();
    delete environment.SOCKET_BROADCAST_KEY;

    const result = validate(environment, "worker");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SOCKET_BROADCAST_KEY");
  });

  it("rejects a non-Valkey connection protocol", () => {
    const environment = validEnvironment();
    environment.VALKEY_URL = "https://valkey.example";

    const result = validate(environment);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must use redis://");
  });
});
