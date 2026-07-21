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
    INTERNAL_API_KEY: "a".repeat(16),
    JWT_SECRET: "a".repeat(32),
    DATABASE_URL: "postgres://cronium:password@postgres:5432/cronium",
    VALKEY_URL: "valkey://valkey:6379",
    REDIS_URL: undefined,
  };
}

function validate(environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [validationScript], {
    env: environment,
    encoding: "utf8",
  });
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

  it("rejects a non-Valkey connection protocol", () => {
    const environment = validEnvironment();
    environment.VALKEY_URL = "https://valkey.example";

    const result = validate(environment);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must use redis://");
  });
});
