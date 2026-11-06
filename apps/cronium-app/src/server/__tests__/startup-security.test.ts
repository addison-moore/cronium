/**
 * @jest-environment node
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

// A load through tsx takes seconds on an idle machine, and far longer on a busy one.
const LOAD_TIMEOUT = 120_000;

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

describe("a malformed ENCRYPTION_KEYS_RETIRED", () => {
  const APP_DIR = path.resolve(__dirname, "../../..");
  const ENV_MODULE = pathToFileURL(path.join(APP_DIR, "src/env.mjs")).href;
  const KEY = "a1b2c3d4".repeat(8);

  const MALFORMED: [string, string][] = [
    ["the inner quotes left out", `[${KEY}]`],
    ["a bare key", KEY],
    ["a JSON object", JSON.stringify({ key: KEY })],
    ["an empty entry", '[""]'],
    ["a key cut short", JSON.stringify([KEY.slice(0, 63)])],
    ["the doc's placeholder", '["<old-hex-key>"]'],
    ["a good key beside a bad one", JSON.stringify([KEY, "nope"])],
  ];
  const WELL_FORMED: [string, string][] = [
    ["empty, as the published compose file passes it when unset", ""],
    ["an empty list", "[]"],
    ["a list of keys", JSON.stringify([KEY, "9f8e7d6c".repeat(8)])],
  ];

  function expectRefusal(result: SpawnSyncReturns<string>): void {
    const output = `${result.stdout}${result.stderr}`;
    // A null status is the process still running at the timeout, so not stopped at all.
    expect(result.status).toBe(1);
    expect(output).toContain("ENCRYPTION_KEYS_RETIRED");
    expect(output).toContain("JSON array of 64-hex keys");
    expect(output).not.toContain(KEY.slice(0, 8));
    expect(output).not.toContain("nope");
  }

  describe.each([
    ["the app", undefined],
    ["the worker", "worker"],
  ])("the image's preflight for %s", (_, role) => {
    it.each(MALFORMED)("%s: refuses to start", (_, list) => {
      expectRefusal(
        validate(
          { ...validEnvironment(), ENCRYPTION_KEYS_RETIRED: list },
          role,
        ),
      );
    });

    it.each(WELL_FORMED)("%s: starts", (_, list) => {
      const result = validate(
        { ...validEnvironment(), ENCRYPTION_KEYS_RETIRED: list },
        role,
      );

      expect(result.status).toBe(0);
    });
  });

  // Loaded as next.config.mjs loads it, by Node with no bundler. This is what stops
  // `next start` and a dev server.
  describe("env.mjs", () => {
    function load(list: string) {
      return spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `await import(${JSON.stringify(ENV_MODULE)});`,
        ],
        {
          env: {
            ...validEnvironment(),
            AUTH_URL: "http://localhost:5001",
            PUBLIC_APP_URL: "http://localhost:5001",
            ENCRYPTION_KEYS_RETIRED: list,
            SKIP_ENV_VALIDATION: undefined,
          },
          encoding: "utf8",
        },
      );
    }

    it.each(MALFORMED)(
      "%s: refuses to load",
      (_, list) => {
        expectRefusal(load(list));
      },
      LOAD_TIMEOUT,
    );

    it.each(WELL_FORMED)(
      "%s: loads",
      (_, list) => {
        const result = load(list);

        expect(result.stderr).not.toContain("ENCRYPTION_KEYS_RETIRED");
        expect(result.status).toBe(0);
      },
      LOAD_TIMEOUT,
    );
  });

  // Each reaches env.mjs through the database module. These prove that still holds, as
  // nothing but start.sh and start-worker.sh checks for them otherwise, and the driver
  // is run in a container that has already started.
  describe("what's run outside the start scripts", () => {
    function run(script: string, list: string, ...args: string[]) {
      return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
        cwd: APP_DIR,
        env: {
          ...validEnvironment(),
          AUTH_URL: "http://localhost:5001",
          PUBLIC_APP_URL: "http://localhost:5001",
          // Nothing listens here, so a process that got past the list can't touch a database.
          DATABASE_URL: "postgres://cronium:password@127.0.0.1:1/cronium",
          ENCRYPTION_KEYS_RETIRED: list,
          SKIP_ENV_VALIDATION: undefined,
        },
        encoding: "utf8",
        timeout: LOAD_TIMEOUT,
      });
    }

    it.each([
      ["the driver", "src/scripts/rotate-secrets.ts"],
      ["the worker", "worker.ts"],
      ["the socket server", "server.ts"],
    ])(
      "%s refuses to start",
      (_, script) => {
        expectRefusal(run(script, `[${KEY}]`));
      },
      LOAD_TIMEOUT + 5_000,
    );

    it(
      "the driver gets as far as the database with a list that's fine",
      () => {
        const result = run(
          "src/scripts/rotate-secrets.ts",
          JSON.stringify([KEY]),
          "--dry-run",
        );

        expect(result.stdout).toContain("(dry run)");
        expect(result.stderr).not.toContain("ENCRYPTION_KEYS_RETIRED");
      },
      LOAD_TIMEOUT + 5_000,
    );
  });
});
